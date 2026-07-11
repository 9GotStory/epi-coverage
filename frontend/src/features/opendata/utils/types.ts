export interface SEpi1Record {
  areacode: string;
  areaname: string;
  target: string;
  [key: string]: string; // Support for bcg_10, dtp1_11, etc.
}

export interface SEpiCompleteRecord {
  hospcode: string;
  target: string;
  result: string;
  [key: string]: string; // Support for target10, result10, etc.
}

// OpenData API simply returns an array directly
export type OpenDataResponse = SEpi1Record[] | SEpiCompleteRecord[];
