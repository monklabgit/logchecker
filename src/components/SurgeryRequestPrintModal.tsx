import { Minus, Plus, Printer, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RequestItem, SurgeryRequest } from '../types';

type SurgeryRequestPrintModalProps = {
  request: SurgeryRequest;
  onClose: () => void;
};

const dateFormatter = new Intl.DateTimeFormat('pt-BR');

const formatDate = (date: string | null) =>
  date ? dateFormatter.format(new Date(`${date}T12:00:00`)) : '';

const formatTime = (time: string | null) => time?.slice(0, 5).replace(':', 'H') || '';

const materialRows = (items: RequestItem[], minimumRows = 2) => {
  const rows: Array<RequestItem | null> = [...items];
  while (rows.length < minimumRows) rows.push(null);
  return rows;
};

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

export function SurgeryRequestPrintModal({ request, onClose }: SurgeryRequestPrintModalProps) {
  const [copies, setCopies] = useState(1);
  const pages = useMemo(() => Array.from({ length: copies }, (_, index) => index + 1), [copies]);

  useEffect(() => {
    const finishPrinting = () => document.body.classList.remove('printing-surgery-request');
    window.addEventListener('afterprint', finishPrinting);
    return () => {
      window.removeEventListener('afterprint', finishPrinting);
      finishPrinting();
    };
  }, []);

  const print = () => {
    document.body.classList.add('printing-surgery-request');
    window.setTimeout(() => window.print(), 80);
  };

  return createPortal(
    <div className="surgery-print-portal">
      <div className="print-preview-backdrop" role="presentation">
        <section className="print-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="print-preview-title">
          <header className="print-preview-toolbar">
            <div>
              <p className="eyebrow">Impressão</p>
              <h2 id="print-preview-title">Solicitação #{String(request.code).padStart(4, '0')}</h2>
              <span>Confira a folha e escolha a quantidade de cópias.</span>
            </div>
            <div className="print-preview-actions">
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
              <button className="card-action-button" type="button" onClick={print}>
                <Printer size={18} />
                Imprimir
              </button>
              <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar impressão">
                <X size={20} />
              </button>
            </div>
          </header>

          <div className="print-pages-preview">
            {pages.map((copy) => <SurgeryRequestSheet request={request} copy={copy} key={copy} />)}
          </div>
        </section>
      </div>
    </div>,
    document.body
  );
}
