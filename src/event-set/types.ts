export interface CRMEventSet {
  event_set_id: string;
  name: string;
  advertiser_id: string;
  create_time?: number;
  update_time?: number;
  event_count?: number;
}

export interface AdvertiserEventSet {
  advertiser_id: string;
  event_set_id: string;
  event_set_name?: string;
  source: 'auto_created' | 'auto_selected' | 'manually_selected' | 'env_fallback';
  created_at: Date;
  updated_at: Date;
}

export type ProvisionResult =
  | { status: 'created_new'; data: AdvertiserEventSet }
  | { status: 'selected_existing'; data: AdvertiserEventSet }
  | { status: 'multiple_found'; data: CRMEventSet[] }
  | { status: 'error'; error: string };
