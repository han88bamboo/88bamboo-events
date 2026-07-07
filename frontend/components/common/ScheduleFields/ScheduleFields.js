// ScheduleFields — the shared date/schedule block for the submit + edit forms
// (EP-6 multi-date scheduling). Parallels LocationFields: the parent owns the
// field values; this component renders the date entry and reports its own blocking
// validation up via onValidationChange(errors).
//
// Two modes, driven purely by values.occurrences:
//   • SINGLE (default) — occurrences empty/absent. Two datetime-local inputs
//     (Starts / Ends) bound to values.start_datetime / values.end_datetime, exactly
//     as before, plus an "Add another date" control. The common case is unchanged
//     (E-D5), so a single-date submit is byte-for-byte the legacy flow.
//   • MULTI — occurrences is a non-empty array. A small table with one DATE + a
//     start time + an end time per row; the date is shared by both times so an
//     occurrence never spans past midnight (single-day only — E-D6). Emits
//     values.occurrences as [{start, end}] in 'YYYY-MM-DDTHH:MM'. The server derives
//     the scalar summary (MIN start / MAX end) from it — it is the single writer of
//     both, so the summary the listing/is_past/auto-expire read never drifts.
import { useEffect } from 'react';

const BLANK_ROW = { start: '', end: '' };

// datetime-local <-> date/time-part helpers. A row's single DATE is shared by its
// start and end time (single-day occurrence, E-D6).
const datePart = (dt) => (dt ? String(dt).slice(0, 10) : '');
const timePart = (dt) => (String(dt || '').length >= 16 ? String(dt).slice(11, 16) : '');
const join = (date, time) => (date && time ? `${date}T${time}` : '');

function ScheduleFields({ values, onChange, onValidationChange }) {
  const occurrences = Array.isArray(values.occurrences) ? values.occurrences : [];
  const multi = occurrences.length > 0;

  // Report blocking validation up to the parent (mirrors LocationFields). String
  // compares are valid because both sides are equal-length 'YYYY-MM-DDTHH:MM'.
  useEffect(() => {
    if (!onValidationChange) return;
    const errs = [];
    if (multi) {
      let valid = 0;
      occurrences.forEach((o, i) => {
        if (!o.start || !o.end) {
          errs.push(`Date ${i + 1}: enter a date with a start and end time.`);
        } else if (o.end <= o.start) {
          errs.push(`Date ${i + 1}: the end time must be after the start time.`);
        } else {
          valid += 1;
        }
      });
      if (valid === 0) errs.push('Add at least one valid date.');
    } else {
      if (!values.start_datetime) errs.push('Start date/time is required.');
      if (!values.end_datetime) errs.push('End date/time is required.');
      if (
        values.start_datetime &&
        values.end_datetime &&
        values.end_datetime < values.start_datetime
      ) {
        errs.push('End date/time cannot be before the start date/time.');
      }
    }
    onValidationChange(errs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi, JSON.stringify(occurrences), values.start_datetime, values.end_datetime]);

  const setOccurrences = (next) => onChange({ occurrences: next });

  // Reveal the table: seed it from the single-date inputs, plus one blank row.
  const addAnotherDate = () => {
    if (multi) {
      setOccurrences([...occurrences, { ...BLANK_ROW }]);
    } else {
      setOccurrences([
        { start: values.start_datetime || '', end: values.end_datetime || '' },
        { ...BLANK_ROW },
      ]);
    }
  };

  // Collapse back to a single date, seeding the inputs from the first row.
  const useSingleDate = () => {
    const first = occurrences[0] || BLANK_ROW;
    onChange({ occurrences: [], start_datetime: first.start, end_datetime: first.end });
  };

  const removeRow = (i) => setOccurrences(occurrences.filter((_, idx) => idx !== i));

  const setRowDate = (i, date) =>
    setOccurrences(
      occurrences.map((o, idx) =>
        idx === i
          ? { start: join(date, timePart(o.start)), end: join(date, timePart(o.end)) }
          : o,
      ),
    );
  const setRowStart = (i, time) =>
    setOccurrences(
      occurrences.map((o, idx) =>
        idx === i ? { ...o, start: join(datePart(o.start) || datePart(o.end), time) } : o,
      ),
    );
  const setRowEnd = (i, time) =>
    setOccurrences(
      occurrences.map((o, idx) =>
        idx === i ? { ...o, end: join(datePart(o.end) || datePart(o.start), time) } : o,
      ),
    );

  const localTimeNote = (
    <p className="form-text mt-0 mb-3">
      Enter the times in the event&apos;s own local time — that&apos;s how they appear on
      the listing.
    </p>
  );

  if (!multi) {
    return (
      <>
        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="start_datetime">
              Starts <span className="text-danger">*</span>
            </label>
            <input
              id="start_datetime"
              type="datetime-local"
              className="form-control"
              value={values.start_datetime || ''}
              onChange={(e) => onChange({ start_datetime: e.target.value })}
              required
            />
          </div>
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="end_datetime">
              Ends <span className="text-danger">*</span>
            </label>
            <input
              id="end_datetime"
              type="datetime-local"
              className="form-control"
              value={values.end_datetime || ''}
              onChange={(e) => onChange({ end_datetime: e.target.value })}
              required
            />
          </div>
        </div>
        {localTimeNote}
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm mb-3"
          onClick={addAnotherDate}
        >
          ＋ Add another date
        </button>
      </>
    );
  }

  return (
    <div className="mb-3">
      <label className="form-label d-block">
        Schedule <span className="text-danger">*</span>
      </label>
      <p className="form-text mt-0">
        This event runs on several dates. Enter a date with its start and end time for
        each one.
      </p>
      {occurrences.map((o, i) => (
        // Rows have no stable id; index keys are fine (order-preserving, no reorder).
        // eslint-disable-next-line react/no-array-index-key
        <div className="row g-2 align-items-end mb-2" key={i}>
          <div className="col-12 col-sm-5">
            <label className="form-label small mb-1" htmlFor={`occ-date-${i}`}>
              Date {i + 1}
            </label>
            <input
              id={`occ-date-${i}`}
              type="date"
              className="form-control"
              value={datePart(o.start) || datePart(o.end)}
              onChange={(e) => setRowDate(i, e.target.value)}
            />
          </div>
          <div className="col-5 col-sm-3">
            <label className="form-label small mb-1" htmlFor={`occ-start-${i}`}>
              Start
            </label>
            <input
              id={`occ-start-${i}`}
              type="time"
              className="form-control"
              value={timePart(o.start)}
              onChange={(e) => setRowStart(i, e.target.value)}
            />
          </div>
          <div className="col-5 col-sm-3">
            <label className="form-label small mb-1" htmlFor={`occ-end-${i}`}>
              End
            </label>
            <input
              id={`occ-end-${i}`}
              type="time"
              className="form-control"
              value={timePart(o.end)}
              onChange={(e) => setRowEnd(i, e.target.value)}
            />
          </div>
          <div className="col-2 col-sm-1">
            <button
              type="button"
              className="btn btn-outline-danger btn-sm w-100"
              aria-label={`Remove date ${i + 1}`}
              onClick={() => removeRow(i)}
              disabled={occurrences.length <= 1}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      {localTimeNote}
      <div className="d-flex gap-2">
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={addAnotherDate}>
          ＋ Add date
        </button>
        <button type="button" className="btn btn-link btn-sm" onClick={useSingleDate}>
          Use a single date instead
        </button>
      </div>
    </div>
  );
}

export default ScheduleFields;
