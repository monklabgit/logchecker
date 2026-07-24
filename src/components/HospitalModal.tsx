import { FormEvent, useState } from 'react';
import { LoaderCircle, Save, X } from 'lucide-react';
import { supabase } from '../supabase';
import type { Hospital } from '../types';

type HospitalForm = {
  name: string;
  address: string;
  loading_access: string;
  cme_location: string;
  opme_location: string;
  surgical_center_location: string;
  notes: string;
  maps_query: string;
  active: boolean;
};

type HospitalModalProps = {
  hospital?: Hospital | null;
  onClose: () => void;
  onSaved: (hospital: Hospital) => void;
};

const emptyForm: HospitalForm = {
  name: '',
  address: '',
  loading_access: '',
  cme_location: '',
  opme_location: '',
  surgical_center_location: '',
  notes: '',
  maps_query: '',
  active: true,
};

const formFromHospital = (hospital?: Hospital | null): HospitalForm =>
  hospital
    ? {
        name: hospital.name,
        address: hospital.address,
        loading_access: hospital.loading_access,
        cme_location: hospital.cme_location,
        opme_location: hospital.opme_location,
        surgical_center_location: hospital.surgical_center_location,
        notes: hospital.notes,
        maps_query: hospital.maps_query,
        active: hospital.active,
      }
    : emptyForm;

export function HospitalModal({ hospital, onClose, onSaved }: HospitalModalProps) {
  const [form, setForm] = useState<HospitalForm>(() => formFromHospital(hospital));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const editing = Boolean(hospital?.id);

  const updateForm = (key: keyof HospitalForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const closeModal = () => {
    if (!saving) onClose();
  };

  const saveHospital = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('Informe o nome do hospital.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      loading_access: form.loading_access.trim(),
      cme_location: form.cme_location.trim(),
      opme_location: form.opme_location.trim(),
      surgical_center_location: form.surgical_center_location.trim(),
      notes: form.notes.trim(),
      maps_query: form.maps_query.trim(),
      active: form.active,
    };

    try {
      if (editing && hospital) {
        const { data, error: updateError } = await supabase
          .from('hospitals')
          .update(payload)
          .eq('id', hospital.id)
          .select('*')
          .single();

        if (updateError) throw updateError;
        onSaved(data as Hospital);
      } else {
        const { data: userData } = await supabase.auth.getUser();
        const { data, error: insertError } = await supabase
          .from('hospitals')
          .insert({
            ...payload,
            created_by: userData.user?.id,
          })
          .select('*')
          .single();

        if (insertError) throw insertError;
        onSaved(data as Hospital);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível salvar o hospital.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
      <section className="hospital-modal" role="dialog" aria-modal="true" aria-labelledby="hospital-modal-title">
        <header className="details-header">
          <div>
            <span className="request-code">{editing ? 'Editando cadastro' : 'Novo cadastro'}</span>
            <h2 id="hospital-modal-title">{editing ? form.name || 'Hospital' : 'Dados do Hospital'}</h2>
            <p>Preencha os detalhes que ajudam entrega, retirada e navegação.</p>
          </div>
          <button className="icon-button" type="button" onClick={closeModal} aria-label="Fechar cadastro">
            <X size={20} />
          </button>
        </header>

        <form className="hospital-modal-body" onSubmit={saveHospital}>
          <div className="operational-form-grid">
            <label>
              <span>Nome do hospital *</span>
              <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} />
            </label>
            <label className="wide">
              <span>Endereço principal</span>
              <input value={form.address} onChange={(event) => updateForm('address', event.target.value)} placeholder="Rua, número, bairro, cidade" />
            </label>
            <label className="wide">
              <span>Entrada / carga e descarga</span>
              <textarea
                value={form.loading_access}
                onChange={(event) => updateForm('loading_access', event.target.value)}
                rows={2}
                placeholder="Ex.: entrar pela rua lateral, doca no subsolo, falar com portaria..."
              />
            </label>
            <label>
              <span>Local do CME</span>
              <input value={form.cme_location} onChange={(event) => updateForm('cme_location', event.target.value)} placeholder="Andar, setor, referência" />
            </label>
            <label>
              <span>Local do OPME</span>
              <input value={form.opme_location} onChange={(event) => updateForm('opme_location', event.target.value)} placeholder="Andar, sala, referência" />
            </label>
            <label>
              <span>Centro cirúrgico</span>
              <input
                value={form.surgical_center_location}
                onChange={(event) => updateForm('surgical_center_location', event.target.value)}
                placeholder="Bloco, recepção, referência"
              />
            </label>
            <label className="wide">
              <span>Texto para GPS / endereço alternativo</span>
              <input
                value={form.maps_query}
                onChange={(event) => updateForm('maps_query', event.target.value)}
                placeholder="Opcional: use quando o GPS deve abrir uma entrada diferente da principal"
              />
            </label>
            <label className="wide">
              <span>Observações e dicas</span>
              <textarea
                value={form.notes}
                onChange={(event) => updateForm('notes', event.target.value)}
                rows={3}
                placeholder="Dicas específicas: onde estacionar, quem procurar, horários, restrições..."
              />
            </label>
            <label className="checkbox-line wide">
              <input type="checkbox" checked={form.active} onChange={(event) => updateForm('active', event.target.checked)} />
              <span>Hospital ativo para novas solicitações</span>
            </label>
          </div>

          {error && <p className="auth-message error">{error}</p>}

          <footer className="details-footer">
            <button className="card-detail-button" type="button" onClick={closeModal} disabled={saving}>
              Cancelar
            </button>
            <button className="card-action-button" type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
              {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Cadastrar hospital'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
