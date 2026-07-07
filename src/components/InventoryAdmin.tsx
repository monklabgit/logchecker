import { useEffect, useMemo, useState } from 'react';
import { Archive, CheckCircle2, FileUp, LoaderCircle, Plus, Search, Upload } from 'lucide-react';
import { supabase } from '../supabase';
import type { InventoryCategory, InventoryItem, InventoryStatus } from '../types';

type InventoryForm = {
  category: InventoryCategory;
  description: string;
  quantity: string;
  kit: string;
  cjk: string;
  status: InventoryStatus;
};

type ImportRow = InventoryForm & {
  rowNumber: number;
  error?: string;
};

const emptyForm: InventoryForm = {
  category: 'instrumental',
  description: '',
  quantity: '',
  kit: '',
  cjk: '',
  status: 'in_stock',
};

const categoryLabels: Record<InventoryCategory, string> = {
  instrumental: 'Instrumental',
  opme: 'OPME',
};

const statusLabels: Record<InventoryStatus, string> = {
  in_stock: 'No estoque',
  in_route: 'Em rota',
  hospital: 'No hospital',
  consigned: 'Consignado',
};

const normalize = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const parseCategory = (value: string): InventoryCategory | null => {
  const normalized = normalize(value);
  if (normalized === 'instrumental' || normalized === 'instrumentais') return 'instrumental';
  if (normalized === 'opme') return 'opme';
  return null;
};

const parseStatus = (value: string): InventoryStatus | null => {
  const normalized = normalize(value);
  if (!normalized || ['estoque', 'no estoque', 'em estoque', 'in_stock'].includes(normalized)) return 'in_stock';
  if (['rota', 'em rota', 'in_route'].includes(normalized)) return 'in_route';
  if (['hospital', 'no hospital'].includes(normalized)) return 'hospital';
  if (['consignado', 'consignada', 'consigned'].includes(normalized)) return 'consigned';
  return null;
};

const headerAliases: Record<keyof InventoryForm, string[]> = {
  category: ['categoria', 'tipo'],
  description: ['descricao', 'descrição', 'material', 'item', 'nome'],
  quantity: ['quantidade', 'qtd', 'qtde'],
  kit: ['kit'],
  cjk: ['cjk', 'codigo do kit', 'código do kit', 'codigo', 'código'],
  status: ['status', 'situacao', 'situação', 'localizacao', 'localização'],
};

const parseDelimitedText = (text: string) => {
  const delimiter = [';', '\t', ','].reduce(
    (best, option) => {
      const count = (text.split('\n')[0].match(new RegExp(option === '\t' ? '\\t' : option, 'g')) || []).length;
      return count > best.count ? { delimiter: option, count } : best;
    },
    { delimiter: ';', count: 0 }
  ).delimiter;

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const buildHeaderMap = (headers: string[]) => {
  const normalizedHeaders = headers.map(normalize);
  const map: Partial<Record<keyof InventoryForm, number>> = {};

  (Object.keys(headerAliases) as Array<keyof InventoryForm>).forEach((key) => {
    const index = normalizedHeaders.findIndex((header) => headerAliases[key].map(normalize).includes(header));
    if (index >= 0) map[key] = index;
  });

  return map.description === undefined ? null : map;
};

const rowToImportItem = (row: string[], rowNumber: number, headerMap: Partial<Record<keyof InventoryForm, number>> | null): ImportRow => {
  const valueAt = (key: keyof InventoryForm, fallbackIndex: number) => row[headerMap?.[key] ?? fallbackIndex]?.trim() || '';
  const category = parseCategory(valueAt('category', 0));
  const status = parseStatus(valueAt('status', 5));
  const description = valueAt('description', 1);

  const item: ImportRow = {
    rowNumber,
    category: category || 'instrumental',
    description,
    quantity: valueAt('quantity', 2),
    kit: valueAt('kit', 3),
    cjk: valueAt('cjk', 4),
    status: status || 'in_stock',
  };

  if (!category) item.error = 'Categoria inválida. Use Instrumental ou OPME.';
  else if (!description) item.error = 'Descrição é obrigatória.';
  else if (!status) item.error = 'Status inválido. Use estoque, em rota, hospital ou consignado.';

  return item;
};

export function InventoryAdmin() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [form, setForm] = useState<InventoryForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | InventoryCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | InventoryStatus>('all');
  const [importRows, setImportRows] = useState<ImportRow[]>([]);

  const filteredItems = useMemo(() => {
    const query = normalize(search);
    return items.filter((item) => {
      const matchesSearch =
        !query ||
        [item.description, item.quantity, item.kit, item.cjk, categoryLabels[item.category], statusLabels[item.status]]
          .join(' ')
          .toLocaleLowerCase('pt-BR')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .includes(query);
      const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [categoryFilter, items, search, statusFilter]);

  const validImportRows = importRows.filter((row) => !row.error);
  const invalidImportRows = importRows.filter((row) => row.error);

  const loadItems = async () => {
    setError('');
    const { data, error: queryError } = await supabase
      .from('inventory_items')
      .select('*')
      .order('updated_at', { ascending: false });

    if (queryError) setError(queryError.message);
    else setItems((data || []) as InventoryItem[]);
    setLoading(false);
  };

  useEffect(() => {
    void loadItems();
  }, []);

  const updateForm = (key: keyof InventoryForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveItem = async () => {
    if (!form.description.trim()) {
      setError('Informe a descrição do material.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');

    const { error: insertError } = await supabase.from('inventory_items').insert({
      category: form.category,
      description: form.description.trim(),
      quantity: form.quantity.trim(),
      kit: form.kit.trim(),
      cjk: form.cjk.trim(),
      status: form.status,
    });

    if (insertError) {
      setError(insertError.message);
    } else {
      setForm(emptyForm);
      setNotice('Item adicionado ao estoque.');
      await loadItems();
    }

    setSaving(false);
  };

  const updateItemStatus = async (item: InventoryItem, status: InventoryStatus) => {
    setError('');
    setNotice('');
    setItems((current) => current.map((currentItem) => (currentItem.id === item.id ? { ...currentItem, status } : currentItem)));

    const { error: updateError } = await supabase.from('inventory_items').update({ status }).eq('id', item.id);
    if (updateError) {
      setError(updateError.message);
      await loadItems();
    }
  };

  const readImportFile = async (file: File) => {
    setError('');
    setNotice('');
    setImportRows([]);

    const extension = file.name.split('.').pop()?.toLocaleLowerCase('pt-BR');
    if (extension === 'xlsx' || extension === 'xls') {
      setError('Por enquanto, exporte a planilha como CSV para importar. O layout esperado é: Categoria, Descrição, Quantidade, KIT, CJK, Status.');
      return;
    }

    const text = await file.text();
    const rows = parseDelimitedText(text);
    if (!rows.length) {
      setError('O arquivo está vazio.');
      return;
    }

    const headerMap = buildHeaderMap(rows[0]);
    const dataRows = headerMap ? rows.slice(1) : rows;
    const parsedRows = dataRows.map((row, index) => rowToImportItem(row, headerMap ? index + 2 : index + 1, headerMap));
    setImportRows(parsedRows);
  };

  const importItems = async () => {
    if (!validImportRows.length) return;

    setImporting(true);
    setError('');
    setNotice('');

    const { error: insertError } = await supabase.from('inventory_items').insert(
      validImportRows.map(({ category, description, quantity, kit, cjk, status }) => ({
        category,
        description,
        quantity,
        kit,
        cjk,
        status,
      }))
    );

    if (insertError) {
      setError(insertError.message);
    } else {
      setNotice(`${validImportRows.length} item(ns) importado(s).`);
      setImportRows([]);
      await loadItems();
    }

    setImporting(false);
  };

  return (
    <section className="admin-view inventory-view">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Controle operacional</p>
          <h1>Estoque</h1>
          <span>Cadastre materiais, acompanhe localização e importe listas em massa.</span>
        </div>
      </header>

      {notice && <p className="auth-message notice">{notice}</p>}
      {error && <p className="auth-message error">{error}</p>}

      <section className="inventory-summary-grid">
        {(Object.keys(statusLabels) as InventoryStatus[]).map((status) => (
          <article className={`inventory-stat status-${status}`} key={status}>
            <span>{statusLabels[status]}</span>
            <strong>{items.filter((item) => item.status === status).length}</strong>
          </article>
        ))}
      </section>

      <section className="request-section">
        <div className="request-section-heading">
          <div>
            <p>Novo material</p>
            <h2>Cadastro rápido</h2>
          </div>
        </div>

        <div className="inventory-form-grid">
          <label>
            <span>Categoria</span>
            <select value={form.category} onChange={(event) => updateForm('category', event.target.value as InventoryCategory)}>
              <option value="instrumental">Instrumental</option>
              <option value="opme">OPME</option>
            </select>
          </label>
          <label className="wide">
            <span>Descrição</span>
            <input value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder="Nome técnico ou comercial" />
          </label>
          <label>
            <span>Quantidade</span>
            <input value={form.quantity} onChange={(event) => updateForm('quantity', event.target.value)} placeholder="1 CX, 1 UND." />
          </label>
          <label>
            <span>KIT</span>
            <input value={form.kit} onChange={(event) => updateForm('kit', event.target.value)} placeholder="Numeração do kit" />
          </label>
          <label>
            <span>CJK</span>
            <input value={form.cjk} onChange={(event) => updateForm('cjk', event.target.value)} placeholder="Código do kit" />
          </label>
          <label>
            <span>Status</span>
            <select value={form.status} onChange={(event) => updateForm('status', event.target.value as InventoryStatus)}>
              {(Object.keys(statusLabels) as InventoryStatus[]).map((status) => (
                <option value={status} key={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <button className="save-request inventory-save-button" type="button" onClick={() => void saveItem()} disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
            Adicionar item
          </button>
        </div>
      </section>

      <section className="request-section">
        <div className="request-section-heading">
          <div>
            <p>Importação em massa</p>
            <h2>Enviar lista</h2>
          </div>
          <label className="inventory-import-button">
            <FileUp size={17} />
            Selecionar CSV
            <input
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readImportFile(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>

        <div className="inventory-import-help">
          <Upload size={18} />
          <p>Use colunas: Categoria, Descrição, Quantidade, KIT, CJK e Status. Também funciona sem cabeçalho nessa mesma ordem.</p>
        </div>

        {importRows.length > 0 && (
          <div className="inventory-import-preview">
            <div>
              <strong>{validImportRows.length} pronto(s) para importar</strong>
              {invalidImportRows.length > 0 && <span>{invalidImportRows.length} linha(s) com ajuste necessário</span>}
            </div>
            <button className="card-action-button" type="button" onClick={() => void importItems()} disabled={!validImportRows.length || importing}>
              {importing ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
              Importar válidos
            </button>
          </div>
        )}

        {invalidImportRows.length > 0 && (
          <div className="inventory-import-errors">
            {invalidImportRows.slice(0, 5).map((row) => (
              <p key={row.rowNumber}>
                Linha {row.rowNumber}: {row.error}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="request-section">
        <div className="request-section-heading inventory-list-heading">
          <div>
            <p>Materiais cadastrados</p>
            <h2>Lista</h2>
          </div>
          <div className="inventory-filters">
            <label className="inventory-search">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar material, KIT ou CJK..." />
            </label>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as 'all' | InventoryCategory)}>
              <option value="all">Todas categorias</option>
              <option value="instrumental">Instrumental</option>
              <option value="opme">OPME</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | InventoryStatus)}>
              <option value="all">Todos status</option>
              {(Object.keys(statusLabels) as InventoryStatus[]).map((status) => (
                <option value={status} key={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="dashboard-loading">
            <LoaderCircle className="spin" size={24} />
            <span>Carregando estoque...</span>
          </div>
        ) : (
          <div className="inventory-table-wrap">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Categoria</th>
                  <th>Quantidade</th>
                  <th>KIT</th>
                  <th>CJK</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.description}</strong>
                    </td>
                    <td>
                      <span className="inventory-chip">{categoryLabels[item.category]}</span>
                    </td>
                    <td>{item.quantity || '-'}</td>
                    <td>{item.kit || '-'}</td>
                    <td>{item.cjk || '-'}</td>
                    <td>
                      <select value={item.status} onChange={(event) => void updateItemStatus(item, event.target.value as InventoryStatus)}>
                        {(Object.keys(statusLabels) as InventoryStatus[]).map((status) => (
                          <option value={status} key={status}>
                            {statusLabels[status]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!filteredItems.length && (
              <div className="empty-column">
                <Archive size={22} />
                <span>Nenhum material encontrado</span>
              </div>
            )}
          </div>
        )}
      </section>
    </section>
  );
}
