import { FileText, Minus, Plus, Printer, Tags, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RequestItem, SurgeryRequest } from '../types';
import './surgery-request-labels.css';

type SurgeryRequestPrintModalProps = {
  request: SurgeryRequest;
  onClose: () => void;
};

type PrintMode = 'request' | 'labels';

type CmeLabel = {
  key: string;
  description: string;
  boxNumber: number;
  boxCount: number;
};

const labelsPerPage = 8;
const dateFormatter = new Intl.DateTimeFormat('pt-BR');

const formatDate = (date: string | null) =>
  date ? dateFormatter.format(new Date(`${date}T12:00:00`)) : '';

const formatTime = (time: string | null) => time?.slice(0, 5).replace(':', 'H') || '';

const materialRows = (items: RequestItem[], minimumRows = 2) => {
  const rows: Array<RequestItem | null> = [...items];
  while (rows.length < minimumRows) rows.push(null);
  return rows;
};

const quantityAsBoxes = (quantity: string) => {
  const parsed = Number.parseInt(quantity.match(/\d+/)?.[0] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 1;
};

const buildCmeLabels = (items: RequestItem[]) =>
  items
    .filter((item) => item.section === 'CME' && item.description.trim())
    .flatMap((item) => {
      const boxCount = quantityAsBoxes(item.quantity);
      return Array.from({ length: boxCount }, (_, index) => ({
        key: `${item.id}-${index + 1}`,
        description: item.description.trim(),
        boxNumber: index + 1,
        boxCount,
      }));
    });

const paginate = <T,>(items: T[], pageSize: number) =>
  Array.from({ length: Math.ceil(items.length / pageSize) }, (_, index) =>
    items.slice(index * pageSize, (index + 1) * pageSize)
  );

function MaterialTable({ title, items }: { title: string; items: RequestItem[] }) {
  return (
    <section className="print-material-section">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th>Quantidade</th>
            <th>Descrição</th>
            <th>Observação</th>
          </tr>
        </thead>
        <tbody>
          {materialRows(items).map((item, index) => (
            <tr key={item?.id || `${title}-blank-${index}`}>
              <td>{item?.quantity || ''}</td>
              <td>{item?.description || ''}</td>
              <td>{item?.note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Signature({ label }: { label: string }) {
  return (
    <div className="print-signature">
      <span />
      <p>{label}</p>
    </div>
  );
}

function SurgeryRequestSheet({ request, copy }: { request: SurgeryRequest; copy: number }) {
  const cmeItems = request.request_items.filter((item) => item.section === 'CME');
  const opmeItems = request.request_items.filter((item) => item.section === 'OPME');
  const compact = request.request_items.length > 12;

  const details = [
    ['Hospital', request.hospital],
    ['Cirurgião', request.surgeon],
    ['Paciente', request.patient],
    ['Data', formatDate(request.surgery_date)],
    ['Hora', formatTime(request.surgery_time)],
    ['Procedimento', request.procedure],
    ['Convênio', request.insurance],
  ];

  return (
    <article
      className={`surgery-print-page ${compact ? 'compact' : ''} ${copy > 1 ? 'print-additional-copy' : ''}`}
      aria-label={`Solicitação para impressão, cópia ${copy}`}
    >
      <div className="print-page-border" />
      <img className="print-watermark" src="/brand/marja-logo.png" alt="" />

      <header className="print-document-header">
        <img className="print-marja-logo" src="/brand/marja-logo.png" alt="Marja" />
        <div className="print-company-name">
          <strong>MARJA COMÉRCIO E REPRESENTAÇÕES E</strong>
          <strong>IMPORTAÇÕES DE PRODUTOS PARA SAÚDE LTDA.</strong>
        </div>
        <div className="print-qr-block">
          <img className="print-qr-code" src="/brand/marja-qrcode.png" alt="QR Code Marja" />
          <span>@MARJA_ORTOPEDIA</span>
        </div>
      </header>

      <div className="print-document-title">
        <h1>SOLICITAÇÃO DE CIRURGIA</h1>
        <span>#{String(request.code).padStart(4, '0')}</span>
      </div>

      <table className="print-request-details">
        <tbody>
          {details.map(([label, value]) => (
            <tr key={label}>
              <th>{label}:</th>
              <td>{value || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <MaterialTable title="CME" items={cmeItems} />
      <div className="print-signature-row">
        <Signature label="Assinatura do Funcionário Marja" />
        <Signature label="Assinatura do Funcionário CME" />
      </div>

      <MaterialTable title="OPME" items={opmeItems} />
      <div className="print-signature-row single">
        <Signature label="Assinatura do Funcionário OPME" />
      </div>
    </article>
  );
}

function CmeLabelsSheet({ request, labels, page }: { request: SurgeryRequest; labels: CmeLabel[]; page: number }) {
  return (
    <article className="cme-labels-print-page" aria-label={`Etiquetas CME, página ${page}`}>
      {labels.map((label) => (
        <section className="cme-box-label" key={label.key}>
          <header>
            <span>CAIXA CME</span>
            <small>{label.boxCount > 1 ? `${label.boxNumber} de ${label.boxCount}` : '1 caixa'}</small>
          </header>
          <h2>{label.description}</h2>
          <dl>
            <div>
              <dt>Cirurgião</dt>
              <dd>{request.surgeon || 'Não informado'}</dd>
            </div>
            <div>
              <dt>Paciente</dt>
              <dd>{request.patient || 'Não informado'}</dd>
            </div>
            <div className="cme-label-date">
              <dt>Data</dt>
              <dd>{formatDate(request.surgery_date) || 'Não informada'}</dd>
            </div>
            <div className="cme-label-time">
              <dt>Horário</dt>
              <dd>{formatTime(request.surgery_time) || 'Não informado'}</dd>
            </div>
            <div className="cme-label-procedure">
              <dt>Procedimento</dt>
              <dd>{request.procedure || 'Não informado'}</dd>
            </div>
          </dl>
        </section>
      ))}
    </article>
  );
}

export function SurgeryRequestPrintModal({ request, onClose }: SurgeryRequestPrintModalProps) {
  const [mode, setMode] = useState<PrintMode>('request');
  const [copies, setCopies] = useState(1);
  const requestPages = useMemo(() => Array.from({ length: copies }, (_, index) => index + 1), [copies]);
  const cmeLabels = useMemo(() => buildCmeLabels(request.request_items), [request.request_items]);
  const labelPages = useMemo(() => paginate(cmeLabels, labelsPerPage), [cmeLabels]);

  useEffect(() => {
    const finishPrinting = () => {
      document.documentElement.classList.remove('printing-mobile-surgery-request');
      document.body.classList.remove('printing-surgery-request', 'printing-mobile-surgery-request');
    };
    window.addEventListener('afterprint', finishPrinting);
    return () => {
      window.removeEventListener('afterprint', finishPrinting);
      finishPrinting();
    };
  }, []);

  const print = () => {
    if (mode === 'labels' && !cmeLabels.length) return;
    const isMobilePrint = window.matchMedia('(max-width: 720px)').matches;
    document.documentElement.classList.toggle('printing-mobile-surgery-request', isMobilePrint);
    document.body.classList.add('printing-surgery-request');
    document.body.classList.toggle('printing-mobile-surgery-request', isMobilePrint);
    window.setTimeout(() => window.print(), 80);
  };

  const subtitle = mode === 'request'
    ? 'Confira a folha e escolha a quantidade de cópias.'
    : `${cmeLabels.length} etiqueta${cmeLabels.length === 1 ? '' : 's'} em ${labelPages.length} folha${labelPages.length === 1 ? '' : 's'} A4.`;

  return createPortal(
    <div className="surgery-print-portal">
      <div className="print-preview-backdrop" role="presentation">
        <section className="print-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="print-preview-title">
          <header className="print-preview-toolbar">
            <div className="print-preview-summary">
              <p className="eyebrow">Impressão</p>
              <h2 id="print-preview-title">Solicitação #{String(request.code).padStart(4, '0')}</h2>
              <span>{subtitle}</span>
              <div className="print-mode-switch" role="tablist" aria-label="Tipo de impressão">
                <button className={mode === 'request' ? 'active' : ''} type="button" role="tab" aria-selected={mode === 'request'} onClick={() => setMode('request')}>
                  <FileText size={16} />
                  Folha da solicitação
                </button>
                <button className={mode === 'labels' ? 'active' : ''} type="button" role="tab" aria-selected={mode === 'labels'} onClick={() => setMode('labels')}>
                  <Tags size={16} />
                  Etiquetas CME
                  <strong>{cmeLabels.length}</strong>
                </button>
              </div>
            </div>
            <div className="print-preview-actions">
              {mode === 'request' && (
                <div className="print-copy-stepper" aria-label="Quantidade de cópias">
                  <button type="button" onClick={() => setCopies((value) => Math.max(1, value - 1))} disabled={copies === 1} aria-label="Diminuir cópias">
                    <Minus size={17} />
                  </button>
                  <label aria-label="Número de cópias">
                    <input type="number" min="1" max="20" value={copies} onChange={(event) => setCopies(Math.min(20, Math.max(1, Number(event.target.value) || 1)))} />
                  </label>
                  <button type="button" onClick={() => setCopies((value) => Math.min(20, value + 1))} disabled={copies === 20} aria-label="Aumentar cópias">
                    <Plus size={17} />
                  </button>
                </div>
              )}
              <button className="card-action-button" type="button" onClick={print} disabled={mode === 'labels' && !cmeLabels.length}>
                <Printer size={18} />
                Imprimir
              </button>
              <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar impressão">
                <X size={20} />
              </button>
            </div>
          </header>

          <div className={`print-pages-preview ${mode === 'labels' ? 'labels-preview' : ''}`}>
            {mode === 'request' && requestPages.map((copy) => <SurgeryRequestSheet request={request} copy={copy} key={copy} />)}
            {mode === 'labels' && labelPages.map((labels, index) => (
              <CmeLabelsSheet request={request} labels={labels} page={index + 1} key={`labels-${index + 1}`} />
            ))}
            {mode === 'labels' && !cmeLabels.length && (
              <div className="cme-labels-empty">
                <Tags size={28} />
                <strong>Nenhum material CME disponível</strong>
                <span>Adicione materiais à seção CME para gerar as etiquetas.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>,
    document.body
  );
}
