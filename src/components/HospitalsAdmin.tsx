import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, Edit3, LoaderCircle, MapPin, Plus } from 'lucide-react';
import { supabase } from '../supabase';
import type { Hospital } from '../types';
import { HospitalModal } from './HospitalModal';

export function HospitalsAdmin() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [editingHospital, setEditingHospital] = useState<Hospital | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');

  const filteredHospitals = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    if (!query) return hospitals;
    return hospitals.filter((hospital) =>
      [hospital.name, hospital.address, hospital.loading_access, hospital.notes]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(query)
    );
  }, [hospitals, search]);

  const loadHospitals = async () => {
    setError('');
    const { data, error: queryError } = await supabase
      .from('hospitals')
      .select('*')
      .order('active', { ascending: false })
      .order('name', { ascending: true });

    if (queryError) setError(queryError.message);
    else setHospitals((data || []) as Hospital[]);
    setLoading(false);
  };

  useEffect(() => {
    void loadHospitals();
  }, []);

  const startNew = () => {
    setEditingHospital(null);
    setError('');
    setNotice('');
    setModalOpen(true);
  };

  const startEdit = (hospital: Hospital) => {
    setEditingHospital(hospital);
    setError('');
    setNotice('');
    setModalOpen(true);
  };

  const handleSaved = async (hospital: Hospital) => {
    setModalOpen(false);
    setEditingHospital(null);
    setNotice(editingHospital ? 'Hospital atualizado.' : 'Hospital cadastrado.');
    await loadHospitals();
  };

  return (
    <section className="admin-view">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Administração</p>
          <h1>Hospitais</h1>
          <span>Cadastre endereços, acessos e dicas úteis para entrega, retirada e navegação.</span>
        </div>
        <button className="secondary-button" type="button" onClick={startNew}>
          <Plus size={17} />
          Novo hospital
        </button>
      </header>

      {notice && <p className="auth-message notice">{notice}</p>}
      {!modalOpen && error && <p className="auth-message error">{error}</p>}

      <section className="request-section">
        <div className="request-section-heading">
          <div>
            <p>Hospitais Cadastrados</p>
            <h2>Lista</h2>
          </div>
          <input className="admin-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar hospital..." />
        </div>

        {loading ? (
          <div className="dashboard-loading">
            <LoaderCircle className="spin" size={24} />
            <span>Carregando hospitais...</span>
          </div>
        ) : (
          <div className="hospital-list">
            {filteredHospitals.map((hospital) => (
              <article className={`hospital-card ${hospital.active ? '' : 'inactive'}`} key={hospital.id}>
                <div>
                  <div className="hospital-card-title">
                    <Building2 size={18} />
                    <h3>{hospital.name}</h3>
                    {hospital.active ? <span><Check size={13} /> Ativo</span> : <span>Inativo</span>}
                  </div>
                  <p><MapPin size={14} /> {hospital.maps_query || hospital.address || 'Endereço não informado'}</p>
                </div>
                <button className="card-detail-button" type="button" onClick={() => startEdit(hospital)}>
                  <Edit3 size={15} />
                  Editar
                </button>
              </article>
            ))}

            {!filteredHospitals.length && (
              <div className="empty-column">
                <Building2 size={22} />
                <span>Nenhum hospital encontrado</span>
              </div>
            )}
          </div>
        )}
      </section>

      {modalOpen && (
        <HospitalModal
          hospital={editingHospital}
          onClose={() => {
            setModalOpen(false);
            setEditingHospital(null);
          }}
          onSaved={(hospital) => void handleSaved(hospital)}
        />
      )}
    </section>
  );
}
