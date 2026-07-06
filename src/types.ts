export type UserRole = 'pending' | 'admin' | 'office' | 'driver' | 'instrumentator';

export type RequestStatus =
  | 'ready_delivery'
  | 'delivery_in_route'
  | 'delivered'
  | 'ready_pickup'
  | 'pickup_in_route'
  | 'returned_stock'
  | 'cancelled';

export type TransportType = 'delivery' | 'pickup';
export type TransportStatus = 'available' | 'assigned' | 'in_route' | 'completed' | 'cancelled';
export type EvidencePhotoType = 'delivery' | 'pickup' | 'instrumentator_release';

export type Profile = {
  id: string;
  full_name: string;
  role: UserRole;
  active: boolean;
};

export type AdminProfile = Profile & {
  email: string;
  created_at: string;
  updated_at: string;
};

export type RoleAccessScope = {
  role: UserRole;
  access_key: string;
  enabled: boolean;
  updated_at: string;
};

export type Hospital = {
  id: string;
  name: string;
  address: string;
  loading_access: string;
  cme_location: string;
  opme_location: string;
  surgical_center_location: string;
  notes: string;
  maps_query: string;
  active: boolean;
  created_at: string;
};

export type RequestItem = {
  id: string;
  section: 'CME' | 'OPME' | 'OTHER';
  quantity: string;
  description: string;
  note: string;
};

export type TransportTask = {
  id: string;
  type: TransportType;
  status: TransportStatus;
  assigned_driver_id: string | null;
  assigned_driver: { id: string; full_name: string } | null;
  origin_label: string;
  destination_label: string;
  scheduled_for: string | null;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  driver_note: string;
  created_at: string;
};

export type EvidencePhoto = {
  id: string;
  request_id: string;
  task_id: string | null;
  photo_type: EvidencePhotoType;
  storage_path: string;
  original_name: string;
  mime_type: string;
  uploaded_by: string;
  created_at: string;
  expires_at: string;
};

export type UserWhatsappConnection = {
  profile_id: string;
  instance_name: string;
  connection_state: 'open' | 'close' | 'connecting' | string;
  group_jid: string;
  group_name: string;
  last_qr_at: string | null;
  connected_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SurgeryRequest = {
  id: string;
  code: number;
  hospital_id: string | null;
  hospital: string;
  hospital_record: Hospital | null;
  surgeon: string;
  patient: string;
  surgery_date: string | null;
  surgery_time: string | null;
  procedure: string;
  observation: string;
  origin: 'manual' | 'image' | 'document';
  status: RequestStatus;
  priority: number;
  created_at: string;
  request_items: RequestItem[];
  transport_tasks: TransportTask[];
  transport_evidence_photos: EvidencePhoto[];
};

export type TransportEvent = {
  id: number;
  action: 'created' | 'claimed' | 'started' | 'completed' | 'cancelled';
  from_status: TransportStatus | null;
  to_status: TransportStatus;
  note: string;
  created_at: string;
  actor_id: string | null;
  actor: { id: string; full_name: string } | null;
};
