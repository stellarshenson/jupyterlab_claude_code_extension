export interface ISession {
  project_path: string;
  encoded_path: string;
  session_id: string;
  name: string;
  name_source: 'session' | 'basename';
  summary: string;
  first_prompt: string;
  message_count: number;
  created: string | null;
  modified: string | null;
  file_mtime: number;
  git_branch: string | null;
  remote_control: boolean;
  favourite: boolean;
  extra_sessions: number;
}

export interface ISessionsListResponse {
  sessions: ISession[];
}

export interface IStatusResponse {
  enabled: boolean;
  claude_path: string | null;
  root_dir: string;
}

export interface IFavouriteRequest {
  project_path: string;
  favourite: boolean;
}

export interface IFavouriteResponse {
  favourites: string[];
}

export interface IRemoveRequest {
  encoded_path: string;
}

export interface IRemoveResponse {
  removed: string;
}

export interface ICleanupRequest {
  encoded_path: string;
}

export interface ICleanupResponse {
  removed_count: number;
}

export interface IBranch {
  session_id: string;
  file_mtime: number;
  label: string;
}

export interface IBranchesResponse {
  current: string;
  total: number;
  branches: IBranch[];
}

export interface ISwitchRequest {
  encoded_path: string;
  session_id: string;
}

export interface ISwitchResponse {
  requested: string;
  current: string | null;
}

export interface IDeleteBranchesRequest {
  encoded_path: string;
  session_ids: string[];
}

export interface IDeleteBranchesResponse {
  removed_count: number;
}

export interface ILaunchTerminalRequest {
  project_path: string;
  /** Omit to start a brand-new claude session instead of resuming one. */
  session_id?: string;
  dangerously_skip_permissions?: boolean;
}

export interface ILaunchTerminalResponse {
  terminal_name: string;
}
