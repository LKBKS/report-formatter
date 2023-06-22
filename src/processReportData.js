/** @typedef {import("./types").ReportDefinition} ReportDefinition */
/** @typedef {import("./types").Metric} Metric */
/** @typedef {import("./types").Column} Column */

/**
 *
 * @param {Record<string, null | string>[]} rows raw data as returned by a call
 *                                               to the API
 * @param {ReportDefinition} definition
 */
export function processReportData(rows, definition) {
  /** @type {Record<string, Record<string, string | number>>} */
  const grouped = {};
  /** @type {Record<string, string | number>} */
  const template = {};

  // initialize the totals row
  // NOTE: the arbitrary values (e.g. totals[someKey]) will be all numbers,
  //       yet it is not possible to express this as Typescript type due to
  //       mixing with the pure string type field "_group_key".
  /** @type {{_count: number, _group_key: string} & Record<string, string | number>} */
  const totals = { _count: 0, _group_key: "_totals" };

  const dimensionSteps = buildDimensionSteps(definition.dimensions, rows);

  const dimensionColumns = buildMeasureColumns(dimensionSteps, definition);

  for (const fact of definition.facts) {
    totals[fact.key] = "";
    template[fact.key] = "";
  }
  for (const dimensionMeasure of dimensionColumns) {
    totals[dimensionMeasure.key] = 0;
    template[dimensionMeasure.key] = 0;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    /** @type {string | number} */
    let groupKey = "";
    /** @type {{_count: number, _group_key: string | number} & Record<string, string | number>} */
    let accumulator;

    if (definition.grouping.length > 0) {
      for (const grouping of definition.grouping) {
        const rowKeyValue = row[grouping.key] || 0;
        /** @type {string | null | number} */
        let groupingKey = row[grouping.key];
        if (grouping.hasOwnProperty("option")) {
          switch (grouping.option) {
            case "year":
              groupingKey = new Date(rowKeyValue).getFullYear();
              break;
            case "month":
              groupingKey = new Date(rowKeyValue).getMonth();
              break;
            case "month-year":
              const monthYearDate = new Date(rowKeyValue);
              groupingKey =
                monthYearDate.getFullYear() * 100 + monthYearDate.getMonth();
              break;
            case "day":
              groupingKey = new Date(rowKeyValue).getDate();
              break;
            case "date":
            default:
              const dt = new Date(rowKeyValue);
              groupingKey =
                (dt.getFullYear() * 100 + dt.getMonth()) * 100 + dt.getDate();
              break;
          }
        }
        groupKey += groupingKey + "|";
      }
    } else {
      groupKey = i;
    }

    const exists = grouped.hasOwnProperty(groupKey);

    // create a clone of the existing accumulator or the blank template
    accumulator = Object.assign({}, exists ? grouped[groupKey] : template, {
      _group_key: groupKey,
      _count: 0,
    });

    for (const fact of definition.facts) {
      // if we want to accumulate fact values into an array, can add it here TODO(ivan)

      /** @type {string | number | null} */
      let factValue = row[fact.key];

      if (fact.type === "currency") {
        // a. normalize to number
        /** @type {number} */
        let numValue;
        if (typeof factValue === "string") {
          numValue = parseInt(factValue);
        } else if (typeof factValue === "number") {
          numValue = factValue;
        } else {
          numValue = Number.NaN;
        }
        // b. show in dollars instead of cents
        if (Number.isNaN(numValue)) {
          factValue = "-";
        } else {
          factValue = Math.round(numValue) / 100;
        }
      }

      if (fact.hasOwnProperty("option")) {
        if (factValue === null || factValue === "") {
          accumulator[fact.key] = "-";
        } else {
          switch (fact.option) {
            case "year":
              if (factValue === null || factValue === "") {
                accumulator[fact.key] = "-";
              } else {
                accumulator[fact.key] = new Date(factValue).getFullYear();
              }
              break;
            case "month":
              if (factValue === null || factValue === "")
                accumulator[fact.key] = "-";
              accumulator[fact.key] = new Intl.DateTimeFormat("en-US", {
                month: "long",
              }).format(new Date(factValue));
              break;
            case "month-year":
              if (factValue === null || factValue === "")
                accumulator[fact.key] = "-";
              accumulator[fact.key] = new Intl.DateTimeFormat("en-US", {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              }).format(new Date(factValue));
              break;
            case "day":
              if (factValue === null || factValue === "")
                accumulator[fact.key] = "-";
              accumulator[fact.key] = new Intl.DateTimeFormat("en-US", {
                month: "long",
                year: "numeric",
              }).format(new Date(factValue));
              break;
            default:
              accumulator[fact.key] = factValue;
          }
        }
      } else {
        // NOTE: Coerce null values into empty strings. Perhaps should use "-"
        //       instead?
        accumulator[fact.key] = factValue ?? "";
      }
    }

    if (definition.dimensions.length > 0) {
      // add measures into the proper dimension sub-column TODO(ivan)
      for (const dimension of definition.dimensions) {
        accumulator[dimension.key] = row[dimension.key] ?? "";
      }
    }

    for (const measure of definition.measures) {
      /** @type {string | number | null} */
      let value = row[measure.key];
      let columnKey = getColumnKey(row, definition.dimensions, measure);

      if (measure.type === "currency") {
        if (value === null) value = 0;
        value = Math.round(parseInt(String(value)) / 100);

        if (measure.option === "average") {
          if (exists) {
            if (!grouped[groupKey].hasOwnProperty(columnKey + "::total")) {
              grouped[groupKey][columnKey + "::total"] = 0;
            }
            if (!grouped[groupKey].hasOwnProperty(columnKey + "::count")) {
              grouped[groupKey][columnKey + "::count"] = 0;
            }
          }

          accumulator[columnKey + "::total"] =
            Number(exists ? grouped[groupKey][columnKey + "::total"] : 0) +
            value;
          accumulator[columnKey + "::count"] =
            Number(exists ? grouped[groupKey][columnKey + "::count"] : 0) + 1;
          if (accumulator[columnKey + "::count"] === 0) {
            accumulator[columnKey] = 0;
          } else {
            accumulator[columnKey] =
              Number(accumulator[columnKey + "::total"]) /
              Number(accumulator[columnKey + "::count"]);
          }
        } else {
          // sum
          accumulator[columnKey] =
            Number(exists ? grouped[groupKey][columnKey] : 0) + value;
        }

        // need to update total handling for average function
        /** @type {number} */ (totals[columnKey]) += value;
      } else {
        if (measure.option === "count") {
          accumulator[columnKey] =
            Number(exists ? grouped[groupKey][columnKey] : 0) + 1;
        } else {
          accumulator[columnKey] = value ?? "";
        }
        /** @type {number} */ (totals[columnKey]) += 1;
      }
    }

    accumulator["_count"] =
      (exists ? Number(grouped[groupKey]["_count"]) : 0) + 1;
    totals["_count"] =
      (totals.hasOwnProperty("_count") ? totals["_count"] : 0) + 1;

    grouped[groupKey] = accumulator;
  }

  return { grouped, totals, dimensionColumns };
}

/** @typedef {Record<string, {option: Metric['option'], steps: (number | string)[]}>} DimensionSteps */

/**
 *
 * @param {Metric[]} dimensions
 * @param {Record<string, string | null>[]} rows
 * @returns {DimensionSteps}
 */
const buildDimensionSteps = (dimensions, rows) => {
  /** @type {Record<string, number>} */
  const dimensionsMax = {};
  /** @type {Record<string, number>} */
  const dimensionsMin = {};
  /** @type {Record<string, Record<string, boolean>>}>} */
  const dimensionsValues = {};
  /** @type DimensionSteps */
  const result = {};
  let v;

  if (dimensions.length > 0) {
    for (const dimension of dimensions) {
      const dimOption = dimension.hasOwnProperty("option")
        ? dimension.option
        : "";
      const dimKey = dimension.key + (dimOption !== "" ? "-" + dimOption : "");

      result[dimKey] = { option: dimOption, steps: [] };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        let value = row[dimension.key];

        if (dimension.type === "date") {
          let dateValue = new Date(value || 0);

          switch (dimension.option) {
            case "year":
              v = dateValue.getFullYear();

              if (!dimensionsMax.hasOwnProperty(dimKey)) {
                dimensionsMax[dimKey] = v;
              } else if (v > dimensionsMax[dimKey]) {
                dimensionsMax[dimKey] = v;
              }

              if (!dimensionsMin.hasOwnProperty(dimKey)) {
                dimensionsMin[dimKey] = v;
              } else if (v < dimensionsMin[dimKey]) {
                dimensionsMin[dimKey] = v;
              }

              break;
            case "month":
              v = dateValue.getFullYear() * 100 + dateValue.getMonth();

              if (!dimensionsMax.hasOwnProperty(dimKey)) {
                dimensionsMax[dimKey] = v;
              } else if (v > dimensionsMax[dimKey]) {
                dimensionsMax[dimKey] = v;
              }

              if (!dimensionsMin.hasOwnProperty(dimKey)) {
                dimensionsMin[dimKey] = v;
              } else if (v < dimensionsMin[dimKey]) {
                dimensionsMin[dimKey] = v;
              }

              break;
            default:
            // do nothing, just use value
          }
        } else {
          if (!dimensionsValues.hasOwnProperty(dimKey))
            dimensionsValues[dimKey] = {};
          if (value !== null && !dimensionsValues[dimKey].hasOwnProperty(value))
            dimensionsValues[dimKey][value] = true;
        }
      }

      if (dimension.type === "date") {
        for (
          let dim = dimensionsMin[dimKey];
          dim <= dimensionsMax[dimKey];
          dim++
        ) {
          switch (dimension.option) {
            case "year":
              result[dimKey].steps.push(dim);
              break;
            case "month":
              const mPart = dim % 100;
              result[dimKey].steps.push(dim);
              if (mPart === 12) dim += 88; // go on to next year the dim++ will add 1 to go to month "101"
              break;
            default:
              result[dimKey].steps.push(dim);
          }
        }
      } else {
        if (!dimensionsValues.hasOwnProperty(dimKey))
          dimensionsValues[dimKey] = {};

        for (const s in dimensionsValues[dimKey]) {
          result[dimKey].steps.push(s);
        }
      }
    }
  }

  return result;
};

/**
 *
 * @param {Record<string, string | null>} row
 * @param {Metric[]} dimensions
 * @param {Metric} measure
 * @returns {string}
 */
const getColumnKey = (row, dimensions, measure) => {
  if (dimensions.length > 0) {
    let columnKey = measure.key + "|";

    // let value = row[measure.key];
    for (const dimension of dimensions) {
      /** @type {string | null | number} */
      let value = row[dimension.key];
      /** @type {Date} */
      let dateValue;
      switch (dimension.option) {
        case "year":
          dateValue = new Date(value || 0);
          value = dateValue.getFullYear();
          break;
        case "month":
          dateValue = new Date(value || 0);
          value = dateValue.getMonth();
          break;
        case "month-year":
          dateValue = new Date(value || 0);
          value = dateValue.getMonth() + "|" + dateValue.getFullYear();
          break;
        case "day":
          dateValue = new Date(value || 0);
          value = dateValue.getDate();
          break;
        case "date":
          dateValue = new Date(value || 0);
          value =
            dateValue.getDate() +
            "|" +
            dateValue.getMonth() +
            "|" +
            dateValue.getFullYear();
          break;
        default:
        // do nothing, just use value
      }
      columnKey += value;
    }

    return columnKey;
  } else {
    return measure.key;
  }
};

/**
 * @param {Column[]} columns
 * @param {(number | string)[]} items
 * @param {Metric['option']} option
 * @returns {Column[]}
 */
const getSubColumns = (columns, items, option) => {
  let subs = [];
  for (const item of items) {
    for (const column of columns) {
      let columnKey = column.key + "|";
      let subheaders = column.subheaders;
      subheaders.push(item);
      subs.push({
        header: column.header,
        subheaders,
        key: columnKey + item,
        columnKey: column.key,
        type: column.type,
        option: option,
      });
    }
  }

  return subs;
};

/**
 *
 * @param {DimensionSteps} dimensionSteps
 * @param {ReportDefinition} definition
 * @returns {Column[]}
 */
const buildMeasureColumns = (dimensionSteps, definition) => {
  /** @type {Column[]} */
  let columns = [];
  if (definition.measures.length > 0) {
    for (const measure of definition.measures) {
      columns.push({ ...measure, subheaders: [], columnKey: measure.key });
    }

    if (definition.dimensions.length > 0) {
      let stepEntries = Object.entries(dimensionSteps); //.reverse();

      for (const step of stepEntries) {
        let [key, stepObject] = step;

        columns = getSubColumns(columns, stepObject.steps, stepObject.option);
      }
    }
  }

  return columns;
};

/** @typedef {(a: any, b: any) => {aValue: any, bValue: any}} ValueGetterFunc */
/** @typedef {Metric & {valueGetter: ValueGetterFunc, order?: 'desc'}} Sorter */

/**
 * Sort processed array (in-place). Returns the same array instance, after
 * sorting.
 *
 * @param {ReportDefinition} definition
 * @param {false | Record<string, string | number>[]} processed
 */
export function sortProcessedResults(definition, processed) {
  if (processed) {
    /** @type {Array<Sorter>} */
    let sortFunctions = [];

    for (const sort of definition.sort) {
      /** @type {Sorter} */
      let sf = Object.assign({}, sort, {
        /** @type {ValueGetterFunc} */
        valueGetter: (a, b) => {
          return { aValue: a[sort.key], bValue: b[sort.key] };
        },
      });

      switch (sort.type) {
        case "date":
          switch (sort.option) {
            case "year":
              sf.valueGetter = (a, b) => {
                return {
                  aValue: new Date(a[sort.key]).getFullYear(),
                  bValue: new Date(b[sort.key]).getFullYear(),
                };
              };
              break;
            case "month-year":
              sf.valueGetter = (a, b) => {
                const aDate = new Date(a[sort.key]),
                  bDate = new Date(b[sort.key]);
                return {
                  aValue: aDate.getFullYear() * 100 + aDate.getMonth(),
                  bValue: bDate.getFullYear() * 100 + bDate.getMonth(),
                };
              };
              break;
            case "month":
              sf.valueGetter = (a, b) => {
                return {
                  aValue: new Date(a[sort.key]).getMonth(),
                  bValue: new Date(b[sort.key]).getMonth(),
                };
              };
              break;
            case "day":
              sf.valueGetter = (a, b) => {
                return {
                  aValue: new Date(a[sort.key]).getDate(),
                  bValue: new Date(b[sort.key]).getDate(),
                };
              };
              break;
            case "date":
            default:
              sf.valueGetter = (a, b) => {
                const aDate = new Date(a[sort.key]),
                  bDate = new Date(b[sort.key]);
                return {
                  aValue:
                    (aDate.getFullYear() * 100 + aDate.getMonth()) * 100 +
                    aDate.getDate(),
                  bValue:
                    (bDate.getFullYear() * 100 + bDate.getMonth()) * 100 +
                    bDate.getDate(),
                };
              };
              break;
          }
          break;
        default:
      }
      sortFunctions.push(sf);
    }

    processed.sort(function (a, b) {
      let result = 0;
      for (const f of sortFunctions) {
        const { aValue, bValue } = f.valueGetter(a, b);
        const asc = f.hasOwnProperty("order")
          ? f.order === "desc"
            ? false
            : true
          : true;
        if (aValue === bValue) {
          result = 0;
        } else if (aValue === null || aValue.toString().trim() === "") {
          return asc ? 1 : -1;
        } else if (bValue === null || bValue.toString().trim() === "") {
          return asc ? -1 : 1;
        } else if (aValue < bValue) {
          return asc ? -1 : 1;
        } else {
          return (asc ? 1 : -1) * +(aValue > bValue);
        }
      }
      return result;
    });
  }

  return processed;
}
