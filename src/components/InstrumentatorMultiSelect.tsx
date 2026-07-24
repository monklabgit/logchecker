import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, UserRound, X } from 'lucide-react';
import './InstrumentatorMultiSelect.css';

type InstrumentatorOption = {
  id: string;
  full_name: string;
};

type InstrumentatorMultiSelectProps = {
  options: InstrumentatorOption[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function InstrumentatorMultiSelect({
  options,
  selectedIds,
  onChange,
  disabled = false,
  placeholder = 'Designar depois',
}: InstrumentatorMultiSelectProps) {
  const pickerId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const selectedNames = options
    .filter((option) => selectedIds.includes(option.id))
    .map((option) => option.full_name);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 620px)');
    const updateMode = () => setIsMobile(mediaQuery.matches);
    updateMode();
    mediaQuery.addEventListener('change', updateMode);
    return () => mediaQuery.removeEventListener('change', updateMode);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!isMobile && rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('mousedown', closeOnOutsideClick);
    };
  }, [isMobile, open]);

  useEffect(() => {
    if (!open || !isMobile) return undefined;

    const documentElement = document.documentElement;
    const previousOverflow = document.body.style.overflow;
    const previousDocumentOverflow = documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    documentElement.style.overflow = 'hidden';
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [isMobile, open]);

  const toggleOption = (instrumentatorId: string) => {
    if (selectedIds.includes(instrumentatorId)) {
      onChange(selectedIds.filter((id) => id !== instrumentatorId));
      return;
    }

    onChange([...selectedIds, instrumentatorId]);
  };

  const optionList = (
    <>
      {selectedNames.length > 0 && (
        <button type="button" className="instrumentator-clear" onClick={() => onChange([])} disabled={disabled}>
          <X size={14} />
          Limpar seleção
        </button>
      )}

      {options.length ? options.map((option) => (
        <label key={option.id}>
          <input
            type="checkbox"
            checked={selectedIds.includes(option.id)}
            onChange={() => toggleOption(option.id)}
            disabled={disabled}
          />
          <UserRound size={15} />
          <span>{option.full_name}</span>
        </label>
      )) : (
        <p>Nenhum instrumentador ativo encontrado.</p>
      )}
    </>
  );

  return (
    <div className={`instrumentator-multi-select ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        className="instrumentator-summary"
        type="button"
        onClick={() => !disabled && setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={`instrumentator-options-${pickerId}`}
      >
        <span className={selectedNames.length ? '' : 'placeholder'}>
          {selectedNames.length ? selectedNames.join(', ') : placeholder}
        </span>
        <ChevronDown size={17} />
      </button>

      {open && !isMobile && (
        <div id={`instrumentator-options-${pickerId}`} className="instrumentator-options" role="group" aria-label="Instrumentadores disponíveis">
          {optionList}
        </div>
      )}

      {open && isMobile && createPortal(
        <div
          className="instrumentator-picker-overlay"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="instrumentator-picker-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`instrumentator-title-${pickerId}`}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="instrumentator-picker-header">
              <div>
                <strong id={`instrumentator-title-${pickerId}`}>Designar Instrumentadores</strong>
                <span>{selectedNames.length ? `${selectedNames.length} selecionado${selectedNames.length > 1 ? 's' : ''}` : 'Seleção opcional'}</span>
              </div>
              <button
                ref={closeButtonRef}
                className="icon-button"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar seleção"
              >
                <X size={20} />
              </button>
            </div>

            <div id={`instrumentator-options-${pickerId}`} className="instrumentator-options" role="group" aria-label="Instrumentadores disponíveis">
              {optionList}
            </div>

            <div className="instrumentator-picker-footer">
              <button className="card-action-button" type="button" onClick={() => setOpen(false)}>
                <Check size={17} />
                Aplicar seleção{selectedNames.length ? ` (${selectedNames.length})` : ''}
              </button>
            </div>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
