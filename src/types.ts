/**
 * An object with field values holding instances of prepared value formatters.
 */
export type Formatters = Record<
  string,
  Intl.DateTimeFormat | Intl.NumberFormat | null
>;

export interface Metric {
  key: string;
  header: string;
  type: "job_number" | "longtext" | "date" | "shorttext" | "name" | "currency";
  option?:
    | "year"
    | "month"
    | "day"
    | "month-year"
    | "date"
    | "average"
    | "count"
    | "";
}

export interface Column extends Metric {
  subheaders: (number | string)[];
  columnKey: string;
}

/**
 * The entirety of a custom report configuration.
 */
export interface ReportDefinition {
  columns: any[];
  dimensions: Metric[];
  facts: Metric[];
  filters: Record<string, any>;
  graphType: boolean;
  grouping: Metric[];
  groupingKeys: any;
  measures: Metric[];
  options: {
    showGroupTotals: boolean;
    showTotals: boolean;
  };
  sort: Metric[];
  source: Metric[];
  view: "report" | "graph";
  xAxis: any[];
  xAxisKeys: any;
  yAxisKeys: any;
  yAxis: any[];
}
