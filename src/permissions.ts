import type { UserRole } from './types';

export type AccessKey =
  | 'view_dashboard'
  | 'create_requests'
  | 'manage_hospitals'
  | 'manage_users'
  | 'claim_routes'
  | 'complete_delivery'
  | 'release_materials'
  | 'complete_pickup'
  | 'view_evidence'
  | 'manage_whatsapp'
  | 'manage_inventory';

export type RoleAccess = Record<AccessKey, boolean>;

export const ROLE_LABELS: Record<UserRole, string> = {
  pending: 'Pendente',
  admin: 'Administrador',
  office: 'Operação',
  driver: 'Motorista',
  instrumentator: 'Instrumentador',
};

export const ACCESS_LABELS: Record<AccessKey, { title: string; description: string }> = {
  view_dashboard: {
    title: 'Visualizar fluxo',
    description: 'Acessar o fluxo de materiais e os detalhes das solicitações.',
  },
  create_requests: {
    title: 'Criar solicitações',
    description: 'Cadastrar novas cirurgias manualmente ou por leitura de imagem.',
  },
  manage_hospitals: {
    title: 'Gerenciar hospitais',
    description: 'Cadastrar e editar informações dos hospitais.',
  },
  manage_users: {
    title: 'Gerenciar usuários',
    description: 'Alterar funções, ativar usuários e editar escopos de acesso.',
  },
  claim_routes: {
    title: 'Assumir rotas',
    description: 'Assumir entregas ou retiradas disponíveis no fluxo.',
  },
  complete_delivery: {
    title: 'Concluir entregas',
    description: 'Registrar evidências e concluir a entrega de materiais.',
  },
  release_materials: {
    title: 'Liberar materiais',
    description: 'Registrar evidências e liberar materiais entregues para retirada.',
  },
  complete_pickup: {
    title: 'Concluir retiradas',
    description: 'Registrar evidências e retornar materiais ao estoque.',
  },
  view_evidence: {
    title: 'Ver evidências',
    description: 'Visualizar fotos anexadas nas etapas do fluxo.',
  },
  manage_whatsapp: {
    title: 'Conectar WhatsApp',
    description: 'Conectar a própria instância de WhatsApp para disparos.',
  },
  manage_inventory: {
    title: 'Gerenciar estoque',
    description: 'Cadastrar materiais, atualizar status e importar itens em massa.',
  },
};

export const ACCESS_KEYS = Object.keys(ACCESS_LABELS) as AccessKey[];

export const DEFAULT_ROLE_ACCESS: Record<UserRole, RoleAccess> = {
  pending: {
    view_dashboard: false,
    create_requests: false,
    manage_hospitals: false,
    manage_users: false,
    claim_routes: false,
    complete_delivery: false,
    release_materials: false,
    complete_pickup: false,
    view_evidence: false,
    manage_whatsapp: false,
    manage_inventory: false,
  },
  admin: {
    view_dashboard: true,
    create_requests: true,
    manage_hospitals: true,
    manage_users: true,
    claim_routes: true,
    complete_delivery: true,
    release_materials: true,
    complete_pickup: true,
    view_evidence: true,
    manage_whatsapp: true,
    manage_inventory: true,
  },
  office: {
    view_dashboard: true,
    create_requests: true,
    manage_hospitals: false,
    manage_users: false,
    claim_routes: false,
    complete_delivery: false,
    release_materials: true,
    complete_pickup: false,
    view_evidence: true,
    manage_whatsapp: true,
    manage_inventory: true,
  },
  driver: {
    view_dashboard: true,
    create_requests: false,
    manage_hospitals: false,
    manage_users: false,
    claim_routes: true,
    complete_delivery: true,
    release_materials: false,
    complete_pickup: true,
    view_evidence: true,
    manage_whatsapp: true,
    manage_inventory: false,
  },
  instrumentator: {
    view_dashboard: true,
    create_requests: false,
    manage_hospitals: false,
    manage_users: false,
    claim_routes: false,
    complete_delivery: false,
    release_materials: true,
    complete_pickup: false,
    view_evidence: true,
    manage_whatsapp: true,
    manage_inventory: false,
  },
};

export const emptyAccessMap = () => structuredClone(DEFAULT_ROLE_ACCESS);
