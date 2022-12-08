// Importing types for typechecking of JS code
// This is analogous to normal Typescript '   import {...} from "..."   '
/** @typedef {import("./types").Formatters} Formatters */
/** @typedef {import("./types").ReportDefinition} ReportDefinition */
/** @typedef {import("./types").Metric} Metric */

export class ReportDataSource {
  /** @type {Record<string, string | number>[]} */
  rowsData;
  /** @type {ReportDefinition} */
  definition;
  /** @type {Formatters} */
  formatters;

  /**
   * @param {Record<string, string | number>[]} rowsData
   * @param {ReportDefinition} reportDefinition
   * @param {Metric[]} dimensionColumns
   * @param {Formatters} formatters
   */
  constructor(
    rowsData,
    reportDefinition,
    dimensionColumns = [],
    formatters = {}
  ) {
    this.rowsData = rowsData;

    const def = Object.assign({}, reportDefinition);
    def.columns = def.columns.concat(dimensionColumns);
    this.definition = def;

    this.formatters = {
      ...ReportDataSource.defaultFormatters,
      ...formatters,
    };
  }

  /** @type {Formatters} */
  static defaultFormatters = {
    month: new Intl.DateTimeFormat("en-US", { month: "long" }),
    monthYear: new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }),
    dat: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }),
    number: new Intl.NumberFormat("en-US", {
      currency: "USD",
      maximumFractionDigits: 0,
      style: "decimal",
    }),
  };

  /**
   * Top "header" rows count
   * @returns {number}
   */
  getFixedRowCount() {
    if (this.definition.dimensions.length > 0) {
      return this.definition.dimensions.length + 1;
    } else {
      return 1;
    }
  }

  /**
   * Side (grouping) columns count
   */
  getFixedColumnCount() {
    return this.definition.grouping.length;
  }

  getTotalRowCount() {
    return this.rowsData.length + this.getFixedRowCount();
  }

  getTotalColumnCount() {
    return this.definition.columns.length;
  }

  /**
   * Compute cell's value for rendering
   *
   * @param {number} rowIndex
   * @param {number} columnIndex
   * @param {Formatters} overrideFormatters
   * @returns {{value: string, isHeader: boolean}}
   */
  buildCellValue(rowIndex, columnIndex, overrideFormatters = {}) {
    const results = this.rowsData;
    const definition = this.definition;
    const formatters = {
      ...this.formatters,
      ...overrideFormatters,
    };

    const fixedRowCount = this.getFixedRowCount();

    if (rowIndex === fixedRowCount - 1) {
      return {
        value: definition.columns[columnIndex].header,
        isHeader: true,
      };
    } else if (rowIndex < fixedRowCount - 1) {
      let subHeader = "";
      if (definition.columns[columnIndex].hasOwnProperty("subheaders")) {
        subHeader = definition.columns[columnIndex].subheaders[rowIndex];
      } else {
        subHeader = definition.dimensions[rowIndex].header;
      }

      return {
        value: subHeader,
        isHeader: true,
      };
    } else {
      const columnKey = definition.columns[columnIndex].key;

      let value = results[rowIndex - fixedRowCount].hasOwnProperty(columnKey)
        ? results[rowIndex - fixedRowCount][columnKey]
        : null;

      if (definition.groupingKeys.hasOwnProperty(columnKey)) {
        if (
          rowIndex - fixedRowCount > 0 &&
          results[rowIndex - fixedRowCount - 1][columnKey] === value
        ) {
          if (value === null || value === "") {
            value = "-";
          } else {
            value = " ";
          }
        }
      }

      switch (definition.columns[columnIndex].type) {
        case "date":
          if (value === null || value === "") {
            value = "-";
          } else if (definition.columns[columnIndex].hasOwnProperty("option")) {
            if (value !== "-") {
              switch (definition.columns[columnIndex].option) {
                case "year":
                  value = new Date(value).getFullYear();
                  break;
                case "month":
                  value = formatters.month
                    ? formatters.month.format(new Date(value).valueOf())
                    : String(value);
                  break;
                case "month-year":
                  value = formatters.monthYear
                    ? formatters.monthYear.format(new Date(value).valueOf())
                    : String(value);
                  break;
                case "day":
                  value = formatters.year
                    ? formatters.year.format(new Date(value).valueOf())
                    : String(value);
                  break;
                default:
                  value = String(value);
              }
            }
          }
          break;
        case "currency":
          if (value === null) value = 0;
          value =
            formatters.number && typeof value === "number"
              ? formatters.number.format(value)
              : String(value);
          break;
        case "job_number":
          break;
        case "longtext":
        case "shorttext":
        default:
          if (value === null || value === "") value = "-";
      }

      // Final sanity checks to enforce returning of a string value
      if (value === null) {
        value = "-";
      } else if (typeof value !== "string") {
        value = String(value);
      }

      return {
        value,
        isHeader: false,
      };
    }
  }

  /**
   * Export current report as a CSV string
   *
   * @param {Formatters} overrideFormatters
   * @returns {string}
   */
  toCSV(overrideFormatters = {}) {
    const rows = [];
    const totalRows = this.getTotalRowCount();
    const totalColumns = this.getTotalColumnCount();

    /**
     * Unless `overrideFormatters` have other opinion, we specifically disable
     * number formatter for purposes of CSV output. This will result in
     * numerical values (price, etc) to be rendered as simple strings.
     * @type {Formatters}
     **/
    const formatters = {
      number: null,
      ...overrideFormatters,
    };

    for (let rowIndex = 0; rowIndex < totalRows; rowIndex++) {
      const row = [];
      for (let colIndex = 0; colIndex < totalColumns; colIndex++) {
        row.push(this.buildCellValue(rowIndex, colIndex, formatters).value);
      }
      rows.push(row);
    }

    return this.rowsToCSV(rows);
  }

  /**
   * Serialize report rows into a CSV file string
   * @param {string[][]} rows
   * @returns {string}
   */
  rowsToCSV(rows) {
    /**
     * @param {string} raw
     * @returns {string}
     */
    function csvEscape(raw) {
      if (typeof raw !== "string") {
        // Just in case some erroneous value made its way here.
        return "";
      }

      if (raw.length === 0) {
        return raw;
      }
      if (
        raw.indexOf(",") >= 0 ||
        raw.indexOf('"') >= 0 ||
        raw.indexOf("\n") >= 0 ||
        raw.indexOf("\r") >= 0
      ) {
        return `"${raw.replaceAll('"', '""')}"`;
      } else {
        return raw;
      }
    }

    /** @type {string[]} */
    const resultPieces = [];

    for (const row of rows) {
      resultPieces.push(row.map(csvEscape).join());
      resultPieces.push("\r\n");
    }

    return resultPieces.join("");
  }
}
