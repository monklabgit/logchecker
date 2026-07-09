import { ChangeEvent, useEffect, useState } from 'react';
import { AlertCircle, Camera, Check, FileUp, LoaderCircle, Minus, Plus, Save, ScanText, Search, Trash2, Upload, X } from 'lucide-react';
import { supabase } from '../supabase';
import type { Hospital, InventoryCategory, InventoryItem } from '../types';
import { HospitalModal } from './HospitalModal';

type SectionName = 'CME' | 'OPME';

type MaterialItem = {
  id: string;
  inventoryItemId: string;
  quantity: string;
  description: string;
  note: string;
};

type RequestForm = {
  hospitalId: string;
  hospital: string;
  surgeon: string;
  patient: string;
  surgeryDate: string;
  surgeryTime: string;
  procedure: string;
  observation: string;
};

type AiMaterialItem = {
  quantity?: string;
  description?: string;
  note?: string;
};

type ExtractionResult = {
  hospital?: string;
  surgeon?: string;
  patient?: string;
  surgeryDate?: string;
  surgeryTime?: string;
  procedure?: string;
  observation?: string;
  cmeItems?: AiMaterialItem[];
  opmeItems?: AiMaterialItem[];
};

type NewRequestFormProps = {
  onSaved: (requestId: string) => void;
  modal?: boolean;
  onClose?: () => void;
};

const initialForm: RequestForm = {
  hospitalId: '',
  hospital: '',
  surgeon: '',
  patient: '',
  surgeryDate: '',
  surgeryTime: '',
  procedure: '',
  observation: '',
};

const makeEmptyItem = (): MaterialItem => ({
  id: crypto.randomUUID(),
  inventoryItemId: '',
  quantity: '',
  description: '',
  note: '',
});

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Arquivo vazio')));
    reader.onerror = () => reject(new Error('Não foi possível abrir o arquivo'));
    reader.readAsDataURL(file);
  });

const dataUrlToImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível preparar a imagem para leitura.'));
    image.src = dataUrl;
  });

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível compactar a imagem.'))), 'image/jpeg', quality);
  });

const prepareImageForAnalysis = async (file: File) => {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= 4 * 1024 * 1024) return file;

  const dataUrl = await readFileAsDataUrl(file);
  const image = await dataUrlToImage(dataUrl);
  const maxEdge = 1800;
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível processar a imagem.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.82, 0.72, 0.62]) {
    const blob = await canvasToBlob(canvas, quality);
    if (blob.size <= 4 * 1024 * 1024 || quality === 0.62) {
      const filename = file.name.replace(/\.[^.]+$/, '') || 'documento';
      return new File([blob], `${filename}.jpg`, { type: 'image/jpeg' });
    }
  }

  return file;
};

const normalizeExtractedDate = (value = '') => {
  const brazilianDate = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return brazilianDate ? `${brazilianDate[3]}-${brazilianDate[2]}-${brazilianDate[1]}` : value;
};

const normalizeExtractedTime = (value = '') => {
  const normalized = value.trim().toUpperCase().replace('H', ':');
  if (/^\d{1,2}$/.test(normalized)) return `${normalized.padStart(2, '0')}:00`;
  if (/^\d{1,2}:$/.test(normalized)) return `${normalized.padStart(3, '0')}00`;
  return normalized.slice(0, 5);
};

const friendlyReadError = (message: string) => {
  if (/incorrect api key|api key|OPENAI_API_KEY|not configured|401/i.test(message)) {
    return 'A IA não conseguiu analisar o arquivo porque a chave da OpenAI está inválida ou não configurada no ambiente atual.';
  }

  if (/failed to fetch|falha na leitura|unexpected token|404|html/i.test(message)) {
    return 'Não consegui chamar a função da IA agora. Verifique se o ambiente está publicado corretamente e tente anexar novamente.';
  }

  return message || 'Não foi possível analisar o arquivo com IA.';
};

const normalizeName = (value = '') =>
  value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const findHospitalMatch = (hospitals: Hospital[], extractedName = '') => {
  const normalizedExtracted = normalizeName(extractedName);
  if (!normalizedExtracted) return null;

  return (
    hospitals.find((hospital) => normalizeName(hospital.name) === normalizedExtracted) ||
    hospitals.find((hospital) => {
      const normalizedHospital = normalizeName(hospital.name);
      return normalizedHospital.includes(normalizedExtracted) || normalizedExtracted.includes(normalizedHospital);
    }) ||
    null
  );
};

const categoryForSection = (section: SectionName): InventoryCategory => (section === 'CME' ? 'instrumental' : 'opme');

const normalizeMaterialPart = (value = '') => normalizeName(value);

const materialDuplicateKey = (description = '', kit = '') => `${normalizeMaterialPart(description)}::${normalizeMaterialPart(kit)}`;

const findInventoryMatch = (items: InventoryItem[], section: SectionName, description = '', kit = '') => {
  const category = categoryForSection(section);
  const descriptionKey = normalizeMaterialPart(description);
  const kitKey = normalizeMaterialPart(kit);
  if (!descriptionKey) return null;

  return (
    items.find(
      (item) =>
        item.category === category &&
        materialDuplicateKey(item.description, item.kit) === materialDuplicateKey(description, kit)
    ) ||
    items.find((item) => {
      if (item.category !== category) return false;
      const itemDescription = normalizeMaterialPart(item.description);
      const itemKit = normalizeMaterialPart(item.kit);
      const descriptionMatches = itemDescription === descriptionKey || itemDescription.includes(descriptionKey) || descriptionKey.includes(itemDescription);
      const kitMatches = !kitKey || !itemKit || itemKit === kitKey;
      return descriptionMatches && kitMatches;
    }) ||
    null
  );
};

export function NewRequestForm({ onSaved, modal = false, onClose }: NewRequestFormProps) {
  const [form, setForm] = useState<RequestForm>(initialForm);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [hospitalModalOpen, setHospitalModalOpen] = useState(false);
  const [cmeItems, setCmeItems] = useState<MaterialItem[]>([makeEmptyItem()]);
  const [opmeItems, setOpmeItems] = useState<MaterialItem[]>([makeEmptyItem()]);
  const [materialSearch, setMaterialSearch] = useState<Record<SectionName, string>>({ CME: '', OPME: '' });
  const [inventoryNotice, setInventoryNotice] = useState('');
  const [priority, setPriority] = useState('2');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState('');
  const [reading, setReading] = useState(false);
  const [readSuccess, setReadSuccess] = useState(false);
  const [readError, setReadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [quickHospitalOpen, setQuickHospitalOpen] = useState(false);
  const [quickHospitalName, setQuickHospitalName] = useState('');
  const [quickHospitalSaving, setQuickHospitalSaving] = useState(false);
  const [quickHospitalError, setQuickHospitalError] = useState('');

  const loadHospitals = async () => {
    const { data } = await supabase
      .from('hospitals')
      .select('*')
      .eq('active', true)
      .order('name', { ascending: true });

    const nextHospitals = (data || []) as Hospital[];
    setHospitals(nextHospitals);
    return nextHospitals;
  };

  const loadInventoryItems = async () => {
    const { data } = await supabase
      .from('inventory_items')
      .select('*')
      .order('description', { ascending: true });

    const nextItems = (data || []) as InventoryItem[];
    setInventoryItems(nextItems);
    return nextItems;
  };

  useEffect(() => {
    let active = true;

    Promise.all([loadHospitals(), loadInventoryItems()]).then(([nextHospitals, nextInventoryItems]) => {
      if (!active) return;
      setHospitals(nextHospitals);
      setInventoryItems(nextInventoryItems);
    });

    return () => {
      active = false;
    };
  }, []);

  const updateForm = (key: keyof RequestForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const chooseHospital = (hospitalId: string) => {
    const hospital = hospitals.find((item) => item.id === hospitalId);
    setForm((current) => ({
      ...current,
      hospitalId,
      hospital: hospital ? hospital.name : '',
    }));
  };

  const handleHospitalSaved = async (hospital: Hospital) => {
    const nextHospitals = await loadHospitals();
    const savedHospital = nextHospitals.find((item) => item.id === hospital.id) || hospital;
    setForm((current) => ({
      ...current,
      hospitalId: savedHospital.id,
      hospital: savedHospital.name,
    }));
    setHospitalModalOpen(false);
  };

  const selectHospital = (hospital: Hospital) => {
    setForm((current) => ({
      ...current,
      hospitalId: hospital.id,
      hospital: hospital.name,
    }));
  };

  const getItems = (section: SectionName) => (section === 'CME' ? cmeItems : opmeItems);
  const setItems = (section: SectionName, items: MaterialItem[]) => {
    if (section === 'CME') setCmeItems(items);
    else setOpmeItems(items);
  };

  const updateItem = (section: SectionName, id: string, key: keyof Omit<MaterialItem, 'id'>, value: string) => {
    setItems(
      section,
      getItems(section).map((item) =>
        item.id === id
          ? {
              ...item,
              [key]: value,
              inventoryItemId: key === 'description' || key === 'note' ? '' : item.inventoryItemId,
            }
          : item
      )
    );
  };

  const removeItem = (section: SectionName, id: string) => {
    const nextItems = getItems(section).filter((item) => item.id !== id);
    setItems(section, nextItems.length ? nextItems : [makeEmptyItem()]);
  };

  const itemsFromExtraction = (section: SectionName, items?: AiMaterialItem[]) => {
    if (!items?.length) return [makeEmptyItem()];
    return items.map((item) => {
      const match = findInventoryMatch(inventoryItems, section, item.description || '', item.note || '');
      return {
        id: crypto.randomUUID(),
        inventoryItemId: match?.id || '',
        quantity: item.quantity || match?.quantity || '',
        description: match?.description || item.description || '',
        note: match?.kit || item.note || '',
      };
    });
  };

  const addInventoryItemToRequest = (section: SectionName, inventoryItem: InventoryItem) => {
    const nextItem: MaterialItem = {
      id: crypto.randomUUID(),
      inventoryItemId: inventoryItem.id,
      quantity: inventoryItem.quantity || '',
      description: inventoryItem.description,
      note: inventoryItem.kit || '',
    };
    const currentItems = getItems(section);
    const emptyIndex = currentItems.findIndex((item) => !item.description.trim() && !item.quantity.trim() && !item.note.trim());
    const nextItems =
      emptyIndex >= 0
        ? currentItems.map((item, index) => (index === emptyIndex ? nextItem : item))
        : [...currentItems, nextItem];

    setItems(section, nextItems);
    setMaterialSearch((current) => ({ ...current, [section]: '' }));
    setInventoryNotice('');
  };

  const saveMaterialToInventory = async (section: SectionName, item: MaterialItem) => {
    const description = item.description.trim();
    const kit = item.note.trim();
    if (!description) return;

    const existing = findInventoryMatch(inventoryItems, section, description, kit);
    if (existing) {
      setItems(
        section,
        getItems(section).map((currentItem) =>
          currentItem.id === item.id
            ? {
                ...currentItem,
                inventoryItemId: existing.id,
                quantity: currentItem.quantity || existing.quantity,
                description: existing.description,
                note: existing.kit || currentItem.note,
              }
            : currentItem
        )
      );
      setInventoryNotice(`Material vinculado ao estoque: ${existing.description}${existing.kit ? ` | ${existing.kit}` : ''}.`);
      return;
    }

    const { data, error: insertError } = await supabase
      .from('inventory_items')
      .insert({
        category: categoryForSection(section),
        description,
        quantity: item.quantity.trim(),
        kit,
        cjk: '',
        status: 'in_stock',
      })
      .select('*')
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    const savedItem = data as InventoryItem;
    setInventoryItems((current) => [...current, savedItem].sort((a, b) => a.description.localeCompare(b.description, 'pt-BR')));
    setItems(
      section,
      getItems(section).map((currentItem) => (currentItem.id === item.id ? { ...currentItem, inventoryItemId: savedItem.id } : currentItem))
    );
    setInventoryNotice(`Material adicionado ao estoque: ${savedItem.description}${savedItem.kit ? ` | ${savedItem.kit}` : ''}.`);
  };

  const applyExtraction = (result: ExtractionResult) => {
    const extractedHospital = result.hospital || '';
    const matchedHospital = findHospitalMatch(hospitals, extractedHospital);
    const nextCmeItems = itemsFromExtraction('CME', result.cmeItems);
    const nextOpmeItems = itemsFromExtraction('OPME', result.opmeItems);
    const missingItems = [...nextCmeItems, ...nextOpmeItems].filter((item) => item.description.trim() && !item.inventoryItemId);

    setForm((current) => ({
      ...current,
      hospitalId: matchedHospital?.id || current.hospitalId,
      hospital: matchedHospital?.name || current.hospital,
      surgeon: result.surgeon || current.surgeon,
      patient: result.patient || current.patient,
      surgeryDate: normalizeExtractedDate(result.surgeryDate) || current.surgeryDate,
      surgeryTime: normalizeExtractedTime(result.surgeryTime) || current.surgeryTime,
      procedure: result.procedure || current.procedure,
      observation: result.observation || current.observation,
    }));
    setCmeItems(nextCmeItems);
    setOpmeItems(nextOpmeItems);
    setInventoryNotice(
      missingItems.length
        ? `${missingItems.length} material(is) não encontrado(s) no estoque. Revise e cadastre pelo botão ao lado do item.`
        : 'Materiais reconhecidos e vinculados ao estoque quando encontrados.'
    );

    if (extractedHospital.trim() && !matchedHospital) {
      setQuickHospitalName(extractedHospital.trim());
      setQuickHospitalError('');
      setQuickHospitalOpen(true);
    }
  };

  const closeQuickHospital = () => {
    if (!quickHospitalSaving) setQuickHospitalOpen(false);
  };

  const saveQuickHospital = async () => {
    const name = quickHospitalName.trim();
    if (!name) {
      setQuickHospitalError('Informe o nome do hospital.');
      return;
    }

    const existing = findHospitalMatch(hospitals, name);
    if (existing) {
      selectHospital(existing);
      setQuickHospitalOpen(false);
      return;
    }

    setQuickHospitalSaving(true);
    setQuickHospitalError('');

    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error: insertError } = await supabase
        .from('hospitals')
        .insert({
          name,
          address: '',
          loading_access: '',
          cme_location: '',
          opme_location: '',
          surgical_center_location: '',
          notes: '',
          maps_query: '',
          active: true,
          created_by: userData.user?.id,
        })
        .select('*')
        .single();

      if (insertError) throw insertError;

      const savedHospital = data as Hospital;
      setHospitals((current) => [...current, savedHospital].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      selectHospital(savedHospital);
      setQuickHospitalOpen(false);
    } catch (caughtError) {
      setQuickHospitalError(caughtError instanceof Error ? caughtError.message : 'Não foi possível cadastrar o hospital.');
    } finally {
      setQuickHospitalSaving(false);
    }
  };

  const processFile = async (file: File) => {
    const maxFileSize = 4 * 1024 * 1024;
    if (!file.type.startsWith('image/')) {
      setAttachment(null);
      setAttachmentPreview('');
      setReadSuccess(false);
      setReadError('Envie uma imagem da solicitação. Arquivos Word foram desativados neste fluxo.');
      return;
    }

    setAttachment(file);
    setAttachmentPreview('');
    setReadSuccess(false);
    setReadError('');
    setError('');

    setReading(true);
    try {
      const previewDataUrl = file.type.startsWith('image/') ? await readFileAsDataUrl(file) : '';
      setAttachmentPreview(previewDataUrl);
      const analysisFile = await prepareImageForAnalysis(file);
      if (analysisFile.size > maxFileSize) {
        throw new Error('O arquivo precisa ter no máximo 4 MB para ser processado pela IA.');
      }

      if (analysisFile !== file) {
        setAttachment(analysisFile);
      }

      const dataUrl = analysisFile === file && previewDataUrl ? previewDataUrl : await readFileAsDataUrl(analysisFile);
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: dataUrl,
          filename: analysisFile.name,
          mimeType: analysisFile.type,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { result?: ExtractionResult; error?: string; detail?: string } | null;
      if (!response.ok || !payload?.result) throw new Error(payload?.detail || payload?.error || 'Falha na leitura');
      applyExtraction(payload.result);
      setReadSuccess(true);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Não foi possível ler o arquivo.';
      setReadError(friendlyReadError(message));
    } finally {
      setReading(false);
    }
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAttachment(file);
    setAttachmentPreview('');
    setReadSuccess(false);
    setReadError('');
    setError('');
    void processFile(file);
  };

  const saveRequest = async () => {
    if (!form.hospitalId) {
      setError('Selecione o hospital. Se ele ainda não existir, clique em “Adicionar hospital”.');
      return;
    }

    const items = [
      ...cmeItems.map((item) => ({ ...item, section: 'CME' })),
      ...opmeItems.map((item) => ({ ...item, section: 'OPME' })),
    ]
      .filter((item) => item.description.trim())
      .map(({ section, inventoryItemId, quantity, description, note }) => ({
        section,
        inventory_item_id: inventoryItemId || null,
        quantity,
        description,
        note,
      }));

    setSaving(true);
    setError('');

    try {
      const origin = attachment ? 'image' : 'manual';
      const { data, error: createError } = await supabase.rpc('create_surgery_request', {
        request_data: {
          hospital_id: form.hospitalId,
          hospital: form.hospital,
          surgeon: form.surgeon,
          patient: form.patient,
          surgery_date: form.surgeryDate,
          surgery_time: form.surgeryTime,
          procedure: form.procedure,
          observation: form.observation,
          priority,
          origin,
        },
        items_data: items,
      });
      if (createError) throw createError;

      onSaved(String(data));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível salvar a solicitação.');
    } finally {
      setSaving(false);
    }
  };

  const renderItems = (section: SectionName, items: MaterialItem[]) => {
    const query = normalizeMaterialPart(materialSearch[section]);
    const selectedKeys = new Set(
      items
        .filter((item) => item.description.trim())
        .map((item) => materialDuplicateKey(item.description, item.note))
    );
    const suggestions = inventoryItems
      .filter((item) => item.category === categoryForSection(section))
      .filter((item) => {
        if (!query) return false;
        const searchable = normalizeMaterialPart([item.description, item.quantity, item.kit, item.cjk].join(' '));
        return searchable.includes(query);
      })
      .filter((item) => !selectedKeys.has(materialDuplicateKey(item.description, item.kit)))
      .slice(0, 6);

    return (
      <section className="request-section" aria-labelledby={`request-${section}`}>
        <div className="request-section-heading material-section-heading">
          <div>
            <p>Materiais</p>
            <h2 id={`request-${section}`}>{section}</h2>
          </div>
          <div className="material-search-wrap">
            <label className="inventory-search material-search">
              <Search size={15} />
              <input
                value={materialSearch[section]}
                onChange={(event) => setMaterialSearch((current) => ({ ...current, [section]: event.target.value }))}
                placeholder="Buscar material, KIT ou CJK..."
              />
            </label>
            <button type="button" onClick={() => setItems(section, [...items, makeEmptyItem()])}>
              <Plus size={17} /> Linha manual
            </button>
          </div>
        </div>

        {suggestions.length > 0 && (
          <div className="material-suggestions" role="listbox" aria-label={`Materiais ${section}`}>
            {suggestions.map((inventoryItem) => (
              <button type="button" key={inventoryItem.id} onClick={() => addInventoryItemToRequest(section, inventoryItem)}>
                <strong>{inventoryItem.description}</strong>
                <span>
                  {[inventoryItem.quantity, inventoryItem.kit, inventoryItem.cjk].filter(Boolean).join(' | ') || 'Sem detalhes'}
                </span>
                <Plus size={15} />
              </button>
            ))}
          </div>
        )}

        <div className="request-items">
          {items.map((item) => (
            <div className={`request-item-row ${item.inventoryItemId ? 'linked' : item.description.trim() ? 'unlinked' : ''}`} key={item.id}>
              <label>
                <span>Quantidade</span>
                <input value={item.quantity} onChange={(event) => updateItem(section, item.id, 'quantity', event.target.value)} />
              </label>
              <label>
                <span>Descrição</span>
                <input value={item.description} onChange={(event) => updateItem(section, item.id, 'description', event.target.value)} />
              </label>
              <label>
                <span>Kit / observação</span>
                <input value={item.note} onChange={(event) => updateItem(section, item.id, 'note', event.target.value)} />
              </label>
              <div className="request-item-actions">
                {item.description.trim() && (
                  <button
                    className={item.inventoryItemId ? 'item-linked-button' : 'item-stock-button'}
                    type="button"
                    onClick={() => void saveMaterialToInventory(section, item)}
                  >
                    {item.inventoryItemId ? 'No estoque' : 'Adicionar ao estoque'}
                  </button>
                )}
                <button className="remove-request-item" type="button" onClick={() => removeItem(section, item.id)} aria-label={`Remover item ${section}`}>
                  {items.length === 1 ? <Minus size={17} /> : <Trash2 size={17} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const formContent = (
    <section className="new-request-view">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Operação logística</p>
          <h1>Nova solicitação</h1>
          <span>Cadastre o material que será enviado ao hospital.</span>
        </div>
      </header>

      <section className="request-source-card">
        <div className="request-source-copy">
          <span className="request-source-icon"><ScanText size={22} /></span>
          <div>
            <h2>Preencher a partir de um documento</h2>
            <p>Fotos da solicitação são analisadas pela IA para preencher os campos automaticamente. Revise tudo antes de salvar.</p>
          </div>
        </div>
        <div className="request-source-actions">
          <label>
            <input accept="image/*" capture="environment" type="file" onChange={handleFile} />
            <Camera size={18} /> Tirar foto
          </label>
          <label>
            <input accept="image/*" type="file" onChange={handleFile} />
            <FileUp size={18} /> Enviar imagem
          </label>
        </div>
        {attachment && (
          <div className={`request-attachment ${reading ? 'loading' : readSuccess ? 'success' : readError ? 'error' : ''}`}>
            {attachmentPreview ? <img src={attachmentPreview} alt="Documento anexado" /> : <span><Upload size={20} /></span>}
            <div>
              <strong>{attachment.name}</strong>
              <small>
                {reading ? 'Analisando com IA...' : readSuccess ? 'Campos preenchidos. Revise antes de salvar.' : readError ? 'Não foi possível analisar com IA.' : 'Arquivo anexado.'}
              </small>
              {readError && <p className="request-read-error">{readError}</p>}
            </div>
            {reading ? <LoaderCircle className="spin" size={20} /> : readSuccess ? <Check size={20} /> : readError ? <AlertCircle size={20} /> : null}
          </div>
        )}
      </section>

      <section className="request-form-card">
        <div className="request-section-heading">
          <div>
            <p>Informações principais</p>
            <h2>Cirurgia e destino</h2>
          </div>
        </div>
        <div className="operational-form-grid">
          <label>
            <span>Hospital *</span>
            <div className="select-with-action">
              <select value={form.hospitalId} onChange={(event) => chooseHospital(event.target.value)}>
                <option value="">Selecionar hospital</option>
                {hospitals.map((hospital) => (
                  <option value={hospital.id} key={hospital.id}>
                    {hospital.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setHospitalModalOpen(true)}>
                <Plus size={16} />
                Adicionar hospital
              </button>
            </div>
          </label>
          <label>
            <span>Procedimento</span>
            <input value={form.procedure} onChange={(event) => updateForm('procedure', event.target.value)} />
          </label>
          <label>
            <span>Cirurgião</span>
            <input value={form.surgeon} onChange={(event) => updateForm('surgeon', event.target.value)} />
          </label>
          <label>
            <span>Paciente</span>
            <input value={form.patient} onChange={(event) => updateForm('patient', event.target.value)} />
          </label>
          <label>
            <span>Data da cirurgia</span>
            <input type="date" value={form.surgeryDate} onChange={(event) => updateForm('surgeryDate', event.target.value)} />
          </label>
          <label>
            <span>Horário</span>
            <input type="time" value={form.surgeryTime} onChange={(event) => updateForm('surgeryTime', event.target.value)} />
          </label>
          <label>
            <span>Prioridade</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="1">Alta</option>
              <option value="2">Normal</option>
              <option value="3">Baixa</option>
            </select>
          </label>
          <label className="wide">
            <span>Observações</span>
            <textarea value={form.observation} onChange={(event) => updateForm('observation', event.target.value)} rows={3} />
          </label>
        </div>
      </section>

      {inventoryNotice && <p className={`auth-message ${/não encontrado/i.test(inventoryNotice) ? 'warning' : 'notice'}`}>{inventoryNotice}</p>}

      {renderItems('CME', cmeItems)}
      {renderItems('OPME', opmeItems)}

      {error && <p className="auth-message error">{error}</p>}

      <footer className="request-submit-bar">
        <p>Ao salvar, a solicitação ficará disponível para acompanhamento operacional.</p>
        <button type="button" onClick={() => void saveRequest()} disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={19} /> : <Save size={19} />}
          {saving ? 'Salvando...' : 'Salvar solicitação'}
        </button>
      </footer>

      {hospitalModalOpen && (
        <HospitalModal hospital={null} onClose={() => setHospitalModalOpen(false)} onSaved={(hospital) => void handleHospitalSaved(hospital)} />
      )}

      {quickHospitalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeQuickHospital()}>
          <section className="quick-hospital-modal" role="dialog" aria-modal="true" aria-labelledby="quick-hospital-title">
            <header>
              <div>
                <p className="eyebrow">hospital não encontrado</p>
                <h2 id="quick-hospital-title">Cadastrar hospital?</h2>
                <span>A IA encontrou este nome, mas ele não existe na lista de hospitais.</span>
              </div>
              <button className="icon-button" type="button" onClick={closeQuickHospital} aria-label="Fechar cadastro rápido">
                <X size={20} />
              </button>
            </header>

            <label>
              <span>Nome do hospital</span>
              <input value={quickHospitalName} onChange={(event) => setQuickHospitalName(event.target.value)} autoFocus />
            </label>

            {quickHospitalError && <p className="auth-message error">{quickHospitalError}</p>}

            <footer>
              <button className="card-detail-button" type="button" onClick={closeQuickHospital} disabled={quickHospitalSaving}>
                Cancelar
              </button>
              <button className="card-action-button" type="button" onClick={() => void saveQuickHospital()} disabled={quickHospitalSaving}>
                {quickHospitalSaving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
                {quickHospitalSaving ? 'Cadastrando...' : 'Cadastrar e selecionar'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );

  if (!modal) return formContent;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="new-request-modal" role="dialog" aria-modal="true" aria-labelledby="new-request-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">OperaÃ§Ã£o logÃ­stica</p>
            <h2 id="new-request-title">Nova solicitaÃ§Ã£o</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar nova solicitaÃ§Ã£o" disabled={saving || reading}>
            <X size={20} />
          </button>
        </header>
        <div className="new-request-modal-body">{formContent}</div>
      </section>
    </div>
  );
}
