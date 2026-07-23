import { ChevronDown, UserRound, X } from 'lucide-react';
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
  const selectedNames = options
    .filter((option) => selectedIds.includes(option.id))
    .map((option) => option.full_name);

  const toggleOption = (instrumentatorId: string) => {
    if (selectedIds.includes(instrumentatorId)) {
      onChange(selectedIds.filter((id) => id !== instrumentatorId));
      return;
    }

    onChange([...selectedIds, instrumentatorId]);
  };

  return (
    <details className="instrumentator-multi-select">
      <summary aria-label="Selecionar instrumentadores">
        <span className={selectedNames.length ? '' : 'placeholder'}>
          {selectedNames.length ? selectedNames.join(', ') : placeholder}
        </span>
        <ChevronDown size={17} />
      </summary>

      <div className="instrumentator-options" role="group" aria-label="Instrumentadores disponíveis">
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
      </div>
    </details>
  );
}
