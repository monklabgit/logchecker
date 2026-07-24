import { Camera, Check, Clipboard, FileText, LoaderCircle, Minus, Plus, RefreshCw, ScanText, Trash2, Upload, X } from 'lucide-react';
import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';

type FlowType = 'ENTRADA' | 'RETIRADA';
type SectionName = 'CME' | 'OPME';

type MaterialItem = {
  id: string;
  quantity: string;
  description: string;
  note: string;
};

type SurgeryForm = {
  hospital: string;
  surgeon: string;
  patient: string;
  surgeryDate: string;
  surgeryTime: string;
  procedure: string;
  receivedCme: string;
  receivedOpme: string;
  observation: string;
};

type ParsedOcr = {
  form: Partial<SurgeryForm>;
  cmeItems: MaterialItem[];
  opmeItems: MaterialItem[];
};

type CropRegion = {
  name: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type SelectedPhoto = {
  file: File;
  dataUrl: string;
};

type AiMaterialItem = {
  quantity?: string;
  description?: string;
  note?: string;
};

type AiExtractionResult = Partial<SurgeryForm> & {
  cmeItems?: AiMaterialItem[];
  opmeItems?: AiMaterialItem[];
  rawText?: string;
};

const separator = '===============';
const thinSeparator = '----------';
const ocrRegions: CropRegion[] = [
  { name: 'details', label: 'dados', x: 0.04, y: 0.24, width: 0.92, height: 0.22 },
  { name: 'materials', label: 'materiais', x: 0.04, y: 0.38, width: 0.92, height: 0.5 },
];

const initialForm: SurgeryForm = {
  hospital: '',
  surgeon: '',
  patient: '',
  surgeryDate: '',
  surgeryTime: '',
  procedure: '',
  receivedCme: '',
  receivedOpme: '',
  observation: '',
};

const fields = [
  { key: 'hospital', label: 'Hospital' },
  { key: 'surgeon', label: 'Cirurgião' },
  { key: 'patient', label: 'Paciente' },
  { key: 'surgeryDate', label: 'Data da Cirurgia' },
  { key: 'surgeryTime', label: 'Horário da Cirurgia' },
  { key: 'procedure', label: 'Procedimento' },
] satisfies Array<{ key: keyof SurgeryForm; label: string }>;

const withdrawalFields = fields.filter((field) => field.key === 'hospital' || field.key === 'procedure');

const makeEmptyItem = (): MaterialItem => ({
  id: crypto.randomUUID(),
  quantity: '',
  description: '',
  note: '',
});

const compact = (value: string) => value.trim();

const normalizeForMatch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const cleanOcrValue = (value: string) =>
  value
    .replace(/^[\s:;.-]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

const fixCommonOcr = (value: string) =>
  value
    .replace(/[|[\]]/g, ' ')
    .replace(/[—–]/g, ' ')
    .replace(/\bO(?=\d)/gi, '0')
    .replace(/\b0(?=\s*(?:CX|X)\b)/gi, '01')
    .replace(/\b0?1\s*I?\s*(?:CX|X)\b/gi, '01 CX')
    .replace(/\b0?2\s*(?:CX|X)\b/gi, '02 CX')
    .replace(/\bK[I1]T\s*([AO])\s*(\d)/gi, 'KIT $2')
    .replace(/\bK[I1]T\s*([0O])(\d)/gi, 'KIT $2')
    .replace(/\bK[I1]T([0-9])/gi, 'KIT $1')
    .replace(/\bK[I1]TA([0-9])/gi, 'KIT $1')
    .replace(/\s{2,}/g, ' ')
    .trim();

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('file-reader-empty'));
    };
    reader.onerror = () => reject(new Error('file-reader-failed'));
    reader.readAsDataURL(file);
  });

const imageToBitmap = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => reject(new Error('image-load-failed'));
    image.src = source;
  });

const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('canvas-blob-failed'));
    }, 'image/png');
  });

const preprocessImageRegion = async (imageSource: string, region: CropRegion) => {
  const image = await imageToBitmap(imageSource);
  const sourceX = Math.round(image.naturalWidth * region.x);
  const sourceY = Math.round(image.naturalHeight * region.y);
  const sourceWidth = Math.round(image.naturalWidth * region.width);
  const sourceHeight = Math.round(image.naturalHeight * region.height);
  const scale = Math.min(3, Math.max(1.6, 2100 / sourceWidth));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('canvas-context-failed');
  }

  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let min = 255;
  let max = 0;

  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    min = Math.min(min, gray);
    max = Math.max(max, gray);
  }

  const range = Math.max(1, max - min);

  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const normalized = Math.max(0, Math.min(255, ((gray - min) / range) * 255));
    const contrasted = normalized > 145 ? 255 : Math.max(0, normalized - 35);

    data[index] = contrasted;
    data[index + 1] = contrasted;
    data[index + 2] = contrasted;
  }

  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
};

const lineHasAny = (line: string, words: string[]) => {
  const normalized = normalizeForMatch(line);
  return words.some((word) => normalized.includes(word));
};

const findLabelValue = (lines: string[], labels: string[]) => {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeForMatch(line);
    const label = labels.find((candidate) => normalizedLine.startsWith(candidate) || normalizedLine.includes(`${candidate}:`));

    if (!label) {
      continue;
    }

    const normalizedLabelIndex = normalizedLine.indexOf(label);
    const rawAfterLabel = line.slice(Math.max(0, normalizedLabelIndex) + label.length);
    const sameLineValue = cleanOcrValue(rawAfterLabel);

    if (sameLineValue) {
      return sameLineValue;
    }

    const nextLine = lines[index + 1];
    if (nextLine && !lineHasAny(nextLine, ['HOSPITAL', 'CIRURGIAO', 'PACIENTE', 'DATA', 'HORA', 'PROCEDIMENTO'])) {
      return cleanOcrValue(nextLine);
    }
  }

  return '';
};

const parseMaterialLine = (line: string): MaterialItem | null => {
  const cleanedLine = fixCommonOcr(cleanOcrValue(line))
    .replace(/\s*\|\s*/g, ' ')
    .replace(/\s{2,}/g, ' ');
  const normalized = normalizeForMatch(cleanedLine);

  if (
    !cleanedLine ||
    lineHasAny(cleanedLine, ['QUANTIDADE', 'DESCRICAO', 'OBSERVACAO', 'ASSINATURA', 'FUNCIONARIO', 'SOLICITACAO'])
  ) {
    return null;
  }

  const quantityMatch = cleanedLine.match(/^(\d{1,2}\s*(?:CX|UN|UND|KIT)?)/i);
  if (!quantityMatch) {
    return null;
  }

  const quantity = quantityMatch[1].replace(/\s+/g, ' ').toUpperCase();
  let rest = cleanOcrValue(cleanedLine.slice(quantityMatch[0].length));
  const kitMatch = rest.match(/\b(KIT\s*(?:\d{1,3}(?:\s*E\s*\d{1,3})?))\b/i);
  const note = kitMatch ? kitMatch[1].replace(/\s+/g, ' ').toUpperCase() : '';

  if (note) {
    rest = cleanOcrValue(rest.replace(kitMatch![0], ''));
  }

  rest = rest
    .replace(/\bBASICADE\b/i, 'BASICA DE')
    .replace(/\bDEACETABULO\b/i, 'DE ACETABULO')
    .replace(/\bFRESADORA\s*KITIBE1S\b/i, 'FRESADORA')
    .replace(/\bEEE+\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!rest || normalized.includes('ASSINATURA') || rest.length < 4) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    quantity,
    description: rest.toUpperCase(),
    note,
  };
};

const parseOcrText = (text: string): ParsedOcr => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => fixCommonOcr(cleanOcrValue(line)))
    .filter(Boolean);
  const cmeItems: MaterialItem[] = [];
  const opmeItems: MaterialItem[] = [];
  let currentSection: SectionName | null = null;

  lines.forEach((line) => {
    if (lineHasAny(line, ['OPME'])) {
      currentSection = 'OPME';
      return;
    }

    if (lineHasAny(line, ['CME'])) {
      currentSection = 'CME';
      return;
    }

    const item = currentSection ? parseMaterialLine(line) : null;
    if (!item) {
      return;
    }

    if (currentSection === 'CME') {
      cmeItems.push(item);
      return;
    }

    opmeItems.push(item);
  });

  return {
    form: {
      hospital: findLabelValue(lines, ['HOSPITAL']),
      surgeon: findLabelValue(lines, ['CIRURGIAO', 'CIRURGIA']),
      patient: findLabelValue(lines, ['PACIENTE']),
      surgeryDate: findLabelValue(lines, ['DATA']),
      surgeryTime: findLabelValue(lines, ['HORA', 'HORARIO']),
      procedure: findLabelValue(lines, ['PROCEDIMENTO']),
    },
    cmeItems,
    opmeItems,
  };
};

function formatItems(items: MaterialItem[]) {
  return items
    .map((item) => {
      const quantity = compact(item.quantity);
      const description = compact(item.description);
      const note = compact(item.note);

      if (!quantity && !description && !note) {
        return '';
      }

      return [quantity, description, note].filter(Boolean).join(' | ');
    })
    .filter(Boolean);
}

function buildMessage(flow: FlowType, form: SurgeryForm, cmeItems: MaterialItem[], opmeItems: MaterialItem[]) {
  const lines: string[] = [];
  const title = compact(form.hospital) ? `${flow} - ${compact(form.hospital)}` : flow;
  const cme = formatItems(cmeItems);
  const opme = formatItems(opmeItems);
  const received =
    flow === 'ENTRADA'
      ? [
          compact(form.receivedCme) ? `CME - ${compact(form.receivedCme)}` : '',
          compact(form.receivedOpme) ? `OPME - ${compact(form.receivedOpme)}` : '',
        ].filter(Boolean)
      : [];

  lines.push(separator, title, separator);

  const detailLines =
    flow === 'ENTRADA'
      ? [
          ['Cirurgião', form.surgeon],
          ['Paciente', form.patient],
          ['Data da Cirurgia', form.surgeryDate],
          ['Horário da Cirurgia', form.surgeryTime],
          ['Procedimento', form.procedure],
        ]
      : [['Procedimento', form.procedure]];

  detailLines.forEach(([label, value]) => {
    if (compact(value)) {
      lines.push(`${label}: ${compact(value)}`);
    }
  });

  if (cme.length) {
    lines.push(separator, 'CME', thinSeparator, ...cme, thinSeparator);
  }

  if (opme.length) {
    lines.push('OPME', thinSeparator, ...opme);
  }

  if (received.length) {
    lines.push(separator, 'Recebido:', ...received);
  }

  if (compact(form.observation)) {
    lines.push(separator, `OBS.: ${compact(form.observation)}`);
  }

  lines.push(separator);
  return lines.join('\n');
}

export function TextGeneratorTool() {
  const [flow, setFlow] = useState<FlowType>('ENTRADA');
  const [form, setForm] = useState<SurgeryForm>(initialForm);
  const [cmeItems, setCmeItems] = useState<MaterialItem[]>([makeEmptyItem()]);
  const [opmeItems, setOpmeItems] = useState<MaterialItem[]>([makeEmptyItem()]);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoName, setPhotoName] = useState('');
  const [copied, setCopied] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  const message = useMemo(() => buildMessage(flow, form, cmeItems, opmeItems), [flow, form, cmeItems, opmeItems]);
  const visibleFields = flow === 'RETIRADA' ? withdrawalFields : fields;

  useEffect(() => {
    const showUpdate = () => setUpdateReady(true);
    window.addEventListener('logchecker-update-ready', showUpdate);

    return () => window.removeEventListener('logchecker-update-ready', showUpdate);
  }, []);

  const updateForm = (key: keyof SurgeryForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const getSection = (section: SectionName) => (section === 'CME' ? cmeItems : opmeItems);
  const setSection = (section: SectionName, items: MaterialItem[]) => {
    if (section === 'CME') {
      setCmeItems(items);
      return;
    }
    setOpmeItems(items);
  };

  const updateItem = (section: SectionName, id: string, key: keyof Omit<MaterialItem, 'id'>, value: string) => {
    setSection(
      section,
      getSection(section).map((item) => (item.id === id ? { ...item, [key]: value } : item))
    );
  };

  const removeItem = (section: SectionName, id: string) => {
    const nextItems = getSection(section).filter((item) => item.id !== id);
    setSection(section, nextItems.length ? nextItems : [makeEmptyItem()]);
  };

  const addItem = (section: SectionName) => {
    setSection(section, [...getSection(section), makeEmptyItem()]);
  };

  const itemsFromAi = (items?: AiMaterialItem[]) =>
    items && items.length
      ? items.map((item) => ({
          id: crypto.randomUUID(),
          quantity: item.quantity || '',
          description: item.description || '',
          note: item.note || '',
        }))
      : [makeEmptyItem()];

  const applyOcrResult = (result: AiExtractionResult) => {
    setForm((current) => ({
      ...current,
      ...Object.fromEntries(
        Object.entries({
          hospital: result.hospital,
          surgeon: result.surgeon,
          patient: result.patient,
          surgeryDate: result.surgeryDate,
          surgeryTime: result.surgeryTime,
          procedure: result.procedure,
          receivedCme: result.receivedCme,
          receivedOpme: result.receivedOpme,
          observation: result.observation,
        }).filter(([, value]) => compact(String(value || '')))
      ),
    }));
    setCmeItems(itemsFromAi(result.cmeItems));
    setOpmeItems(itemsFromAi(result.opmeItems));
  };

  const runOcr = async (photo: SelectedPhoto) => {
    setIsReading(true);
    setOcrError('');
    setOcrStatus('Enviando para IA');
    setOcrProgress(15);
    setOcrText('');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Sessão ausente. Entre novamente.');

      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: photo.dataUrl }),
      });
      setOcrProgress(70);

      const payload = (await response.json().catch(() => null)) as { result?: AiExtractionResult; error?: string; detail?: string } | null;

      if (!response.ok || !payload?.result) {
        throw new Error(payload?.detail || payload?.error || 'falha na leitura por IA');
      }

      setOcrText(payload.result.rawText || '');
      applyOcrResult(payload.result);
      setOcrProgress(100);
      setOcrStatus('Leitura por IA concluída');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'erro desconhecido';
      setOcrError(`Não foi possível ler a imagem por IA. Detalhe: ${detail}.`);
      setOcrStatus('');
    } finally {
      setIsReading(false);
    }
  };

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    event.target.value = '';

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPhotoName(file.name);
      setPhotoPreview(dataUrl);
      void runOcr({ file, dataUrl });
    } catch {
      setPhotoName(file.name);
      setPhotoPreview('');
      setOcrError('Não foi possível abrir a imagem selecionada.');
    }
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = message;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const applyUpdate = () => {
    window.dispatchEvent(new CustomEvent('logchecker-apply-update'));
  };

  const renderItems = (section: SectionName, items: MaterialItem[]) => (
    <section className="panel list-panel" aria-label={section}>
      <div className="panel-title">
        <h2>{section}</h2>
        <button className="icon-button add" type="button" onClick={() => addItem(section)} aria-label={`Adicionar ${section}`}>
          <Plus size={20} />
        </button>
      </div>

      <div className="items">
        {items.map((item) => (
          <div className="item-row" key={item.id}>
            <input
              aria-label={`Quantidade ${section}`}
              className="quantity"
              value={item.quantity}
              onChange={(event) => updateItem(section, item.id, 'quantity', event.target.value)}
            />
            <input
              aria-label={`Descrição ${section}`}
              className="description"
              value={item.description}
              onChange={(event) => updateItem(section, item.id, 'description', event.target.value)}
            />
            <input
              aria-label={`Kit ${section}`}
              className="note"
              value={item.note}
              onChange={(event) => updateItem(section, item.id, 'note', event.target.value)}
            />
            <button className="icon-button danger" type="button" onClick={() => removeItem(section, item.id)} aria-label={`Remover ${section}`}>
              {items.length === 1 ? <Minus size={18} /> : <Trash2 size={18} />}
            </button>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <>
      {updateReady && (
        <div className="update-banner" role="status">
          <span>Nova versão disponível</span>
          <button type="button" onClick={applyUpdate}>
            <RefreshCw size={16} />
            <span>Atualizar</span>
          </button>
        </div>
      )}

      <div className="workspace">
        <div className="editor-stack">
          <section className="panel">
            <div className="flow-switch" role="group" aria-label="Tipo de movimentação">
              {(['ENTRADA', 'RETIRADA'] as FlowType[]).map((option) => (
                <button className={flow === option ? 'active' : ''} key={option} type="button" onClick={() => setFlow(option)}>
                  {option}
                </button>
              ))}
            </div>

            <div className="photo-actions">
              <label className="photo-drop">
                <input accept="image/*" capture="environment" type="file" onChange={handlePhoto} />
                <span className="photo-icon">
                  <Camera size={22} />
                </span>
                <span>Câmera</span>
              </label>
              <label className="photo-drop">
                <input accept="image/*" type="file" onChange={handlePhoto} />
                <span className="photo-icon">
                  <Upload size={22} />
                </span>
                <span>Galeria</span>
              </label>
            </div>

            {photoName && (
              <div className="file-summary">
                {photoPreview ? <img className="file-thumb" src={photoPreview} alt="Miniatura do documento" /> : <span className="file-thumb empty" />}
                <div className="file-meta">
                  <p className="photo-name">{photoName}</p>
                  {(isReading || ocrStatus || ocrError) && (
                    <div className="compact-ocr-status">
                      <ScanText size={15} />
                      <span>{isReading ? `${ocrStatus || 'Lendo imagem'} ${ocrProgress}%` : ocrError ? 'Falha na leitura' : ocrStatus}</span>
                    </div>
                  )}
                </div>
                {isReading && (
                  <span className="read-indicator loading" aria-label="Leitura em andamento">
                    <LoaderCircle size={18} />
                  </span>
                )}
                {!isReading && ocrStatus && !ocrError && (
                  <span className="read-indicator done" aria-label="Leitura concluída">
                    <Check size={18} />
                  </span>
                )}
                {isReading && (
                  <div className="progress-track" aria-label="Progresso da leitura">
                    <span style={{ width: `${ocrProgress}%` }} />
                  </div>
                )}
                {ocrError && <p className="ocr-error">{ocrError}</p>}
              </div>
            )}
          </section>

          <section className="panel form-grid" aria-label="Dados da cirurgia">
            {visibleFields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                <div className="input-with-action">
                  <input value={form[field.key]} onChange={(event) => updateForm(field.key, event.target.value)} />
                  {form[field.key] && (
                    <button className="clear-field" type="button" onClick={() => updateForm(field.key, '')} aria-label={`Limpar ${field.label}`}>
                      <X size={16} />
                    </button>
                  )}
                </div>
              </label>
            ))}
          </section>

          {renderItems('CME', cmeItems)}
          {renderItems('OPME', opmeItems)}

          <section className="panel form-grid small">
            {flow === 'ENTRADA' && (
              <>
                <label>
                  <span>Recebido no CME</span>
                  <input value={form.receivedCme} onChange={(event) => updateForm('receivedCme', event.target.value)} placeholder="Nome" />
                </label>
                <label>
                  <span>Recebido no OPME</span>
                  <input value={form.receivedOpme} onChange={(event) => updateForm('receivedOpme', event.target.value)} placeholder="Nome" />
                </label>
              </>
            )}
            <label className="wide">
              <span>OBS.</span>
              <textarea value={form.observation} onChange={(event) => updateForm('observation', event.target.value)} rows={3} />
            </label>
          </section>
        </div>

        <aside className="result-panel" aria-label="Mensagem final">
          <div className="result-header">
            <div>
              <FileText size={22} />
              <h2>Mensagem</h2>
            </div>
            <button className="copy-button" type="button" onClick={copyMessage}>
              {copied ? <Check size={18} /> : <Clipboard size={18} />}
              <span>{copied ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>
          <textarea className="message-box" value={message} readOnly aria-label="Texto para copiar" />
        </aside>
      </div>
    </>
  );
}
