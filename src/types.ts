export type PathMapping = {
  path: string;
  url: string;
};

export type ScreenshotJson = {
  [key: string]: PathMapping[];
};

export interface ToolsApiData {
  [key: string]: ApiTool;
}

export interface ToolPricePlan {
  free: boolean;
  oss: boolean;
}

export interface ToolResource {
  title: string;
  url: string;
}

export interface ApiTool {
  name: string;
  categories: string[];
  languages: string[];
  other: string[];
  licenses: string[];
  types: string[];
  homepage: string;
  source: string | null;
  pricing: string | null;
  plans: ToolPricePlan | null;
  description: string | null;
  discussion: string | null;
  deprecated: boolean | null;
  resources: ToolResource[] | null;
  wrapper: string | null;
  votes: number;
  upVotes?: number;
  downVotes?: number;
}
