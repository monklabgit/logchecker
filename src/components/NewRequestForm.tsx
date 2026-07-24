import { KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Minus, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { supabase } from '../supabase';
import type { Hospital, InventoryCategory, InventoryItem, Profile } from '../types';
import { HospitalModal } from './HospitalModal';
import { InstrumentatorMultiSelect } from './InstrumentatorMultiSelect';

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
  insurance: string;
  observation: string;
  assignedInstrumentatorIds: string[];
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
  insurance: '',
  observation: '',
  assignedInstrumentatorIds: [],
};

const makeEmptyItem = (): MaterialItem => ({
  id: crypto.randomUUID(),
  inventoryItemId: '',
  quantity: '',
  description: '',
  note: '',
});

const normalizeName = (value = '') =>
  value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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
  const [instrumentators, setInstrumentators] = useState<Pick<Profile, 'id' | 'full_name'>[]>([]);
  const [hospitalModalOpen, setHospitalModalOpen] = useState(false);
  const [cmeItems, setCmeItems] = useState<MaterialItem[]>([makeEmptyItem()]);
  const [opmeItems, setOpmeItems] = useState<MaterialItem[]>([makeEmptyItem()]);
  const [materialSearch, setMaterialSearch] = useState<Record<SectionName, string>>({ CME: '', OPME: '' });
  const [inventoryNotice, setInventoryNotice] = useState('');
  const [priority, setPriority] = useState('2');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const quantityInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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

  const loadInstrumentators = async () => {
    const { data } = await supabase.rpc('list_active_instrumentators');
    const nextInstrumentators = (data || []) as Pick<Profile, 'id' | 'full_name'>[];
    setInstrumentators(nextInstrumentators);
    return nextInstrumentators;
  };

  useEffect(() => {
    let active = true;

    Promise.all([loadHospitals(), loadInventoryItems(), loadInstrumentators()]).then(([nextHospitals, nextInventoryItems]) => {
      if (!active) return;
      setHospitals(nextHospitals);
      setInventoryItems(nextInventoryItems);
    });

    return () => {
      active = false;
    };
  }, []);

  const updateForm = <K extends keyof RequestForm>(key: K, value: RequestForm[K]) => {
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

  const addManualItem = (section: SectionName, afterItemId?: string) => {
    const currentItems = getItems(section);
    const currentIndex = afterItemId ? currentItems.findIndex((item) => item.id === afterItemId) : currentItems.length - 1;
    const insertionIndex = currentIndex >= 0 ? currentIndex + 1 : currentItems.length;
    const nextItem = currentItems[insertionIndex];

    if (nextItem && !nextItem.quantity.trim() && !nextItem.description.trim() && !nextItem.note.trim()) {
      window.requestAnimationFrame(() => quantityInputRefs.current[nextItem.id]?.focus());
      return;
    }

    const newItem = makeEmptyItem();
    setItems(section, [
      ...currentItems.slice(0, insertionIndex),
      newItem,
      ...currentItems.slice(insertionIndex),
    ]);
    window.requestAnimationFrame(() => quantityInputRefs.current[newItem.id]?.focus());
  };

  const handleMaterialEnter = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    section: SectionName,
    itemId: string
  ) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    addManualItem(section, itemId);
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
      const { data, error: createError } = await supabase.rpc('create_surgery_request_with_instrumentators', {
        request_data: {
          hospital_id: form.hospitalId,
          hospital: form.hospital,
          surgeon: form.surgeon,
          patient: form.patient,
          surgery_date: form.surgeryDate,
          surgery_time: form.surgeryTime,
          procedure: form.procedure,
          insurance: form.insurance,
          assigned_instrumentator_ids: form.assignedInstrumentatorIds,
          observation: form.observation,
          priority,
          origin: 'manual',
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
            <button type="button" onClick={() => addManualItem(section)}>
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
                <input
                  ref={(element) => { quantityInputRefs.current[item.id] = element; }}
                  value={item.quantity}
                  onChange={(event) => updateItem(section, item.id, 'quantity', event.target.value)}
                  onKeyDown={(event) => handleMaterialEnter(event, section, item.id)}
                />
              </label>
              <label>
                <span>Descrição</span>
                <input
                  value={item.description}
                  onChange={(event) => updateItem(section, item.id, 'description', event.target.value)}
                  onKeyDown={(event) => handleMaterialEnter(event, section, item.id)}
                />
              </label>
              <label>
                <span>Kit / observação</span>
                <input
                  value={item.note}
                  onChange={(event) => updateItem(section, item.id, 'note', event.target.value)}
                  onKeyDown={(event) => handleMaterialEnter(event, section, item.id)}
                />
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
          <p className="eyebrow">Operação Logística</p>
          <h1>Nova Solicitação</h1>
          <span>Cadastre o material que será enviado ao hospital.</span>
        </div>
      </header>

      <section className="request-form-card">
        <div className="request-section-heading">
          <div>
            <p>Informações Principais</p>
            <h2>Cirurgia e Destino</h2>
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
            <span>Convênio</span>
            <input value={form.insurance} onChange={(event) => updateForm('insurance', event.target.value)} placeholder="Ex.: SUS, Unimed, particular" />
          </label>
          <div className="multi-select-field">
            <span>Instrumentadores</span>
            <InstrumentatorMultiSelect
              options={instrumentators}
              selectedIds={form.assignedInstrumentatorIds}
              onChange={(selectedIds) => updateForm('assignedInstrumentatorIds', selectedIds)}
            />
          </div>
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

    </section>
  );

  if (!modal) return formContent;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="new-request-modal" role="dialog" aria-modal="true" aria-labelledby="new-request-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">Operação Logística</p>
            <h2 id="new-request-title">Nova Solicitação</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar nova solicitação" disabled={saving}>
            <X size={20} />
          </button>
        </header>
        <div className="new-request-modal-body">{formContent}</div>
      </section>
    </div>
  );
}
