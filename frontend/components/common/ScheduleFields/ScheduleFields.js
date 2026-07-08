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
//     occurrence never spans past midnight (single-day only — E-D6).
//
// The occurrence rows are held as SEPARATE parts { date, start, end } — date as
// 'YYYY-MM-DD', start/end as 'HH:MM' — so editing one field never clears another
// (a combined datetime string can't represent a date typed before its time, which
// made partial entry vanish). They are combined into wire {start, end} datetimes
// only at the form's submit boundary via toWireOccurrences(); the server then
// derives the scalar summary (MIN start / MAX end) from them.
import { useEffect, useRef } from 'react';

const BLANK_ROW = { date: '', start: '', end: '' };

// 'HH:MM' from an ISO / 'YYYY-MM-DDTHH:MM…' datetime (the segment after the 'T').
const hhmm = (dt) => {
  const s = String(dt || '');
  return s.length >= 16 ? s.slice(11, 16) : '';
};

// A serialised occurrences list ([{start,end}] ISO from the backend) -> the
// editable { date, start, end } part shape. Only a genuine multi-date schedule
// (>1 date) opens the table; a single/legacy date uses the scalar start/end, so
// this returns undefined for <= 1 (the parent then stays in single mode).
export function toEditableOccurrences(list) {
  if (!Array.isArray(list) || list.length <= 1) return undefined;
  return list.map((o) => ({
    date: String(o.start || o.end || '').slice(0, 10),
    start: hhmm(o.start),
    end: hhmm(o.end),
  }));
}

// The editable { date, start, end } part shape -> wire {start, end} as
// 'YYYY-MM-DDTHH:MM' (or '' for an incomplete row, which the server/inline rules
// then reject). Called by the forms when assembling the submit payload.
export function toWireOccurrences(list) {
  return (list || []).map((o) => ({
    start: o.date && o.start ? `${o.date}T${o.start}` : '',
    end: o.date && o.end ? `${o.date}T${o.end}` : '',
  }));
}

// Seed a first row from the single-date inputs when the table is first revealed.
const partsFromLocal = (start, end) => ({
  date: String(start || end || '').slice(0, 10),
  start: hhmm(start),
  end: hhmm(end),
});

function ScheduleFields({ values, onChange, onValidationChange }) {
  const occurrences = Array.isArray(values.occurrences) ? values.occurrences : [];
  const multi = occurrences.length > 0;

  // Single-date smart default: while the user has not taken ownership of "Ends",
  // it auto-follows "Starts" (same 'YYYY-MM-DDTHH:MM' verbatim, zero duration) so
  // the user only nudges the time instead of re-typing the whole date. This is a
  // one-time default, NOT a permanent mirror: the moment the user edits Ends the
  // ref flips and later Starts changes never clobber it. Edit surfaces mount with
  // Ends already prefilled, so the flag starts "owned" and no auto-fill fires
  // there. Only the single-date pair is affected; the multi-date table (below)
  // keeps its own independent per-row parts.
  const endOwnedRef = useRef(Boolean(values.end_datetime));

  const handleStartChange = (value) => {
    const patch = { start_datetime: value };
    if (!endOwnedRef.current) patch.end_datetime = value;
    onChange(patch);
  };

  const handleEndChange = (value) => {
    endOwnedRef.current = true;
    onChange({ end_datetime: value });
  };

  // Report blocking validation up to the parent (mirrors LocationFields). 'HH:MM'
  // string compares are valid because both times share the row's single date.
  useEffect(() => {
    if (!onValidationChange) return;
    const errs = [];
    if (multi) {
      let valid = 0;
      occurrences.forEach((o, i) => {
        if (!o.date || !o.start || !o.end) {
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
        partsFromLocal(values.start_datetime, values.end_datetime),
        { ...BLANK_ROW },
      ]);
    }
  };

  // Collapse back to a single date, seeding the inputs from the first row.
  const useSingleDate = () => {
    const first = occurrences[0] || BLANK_ROW;
    onChange({
      occurrences: [],
      start_datetime: first.date && first.start ? `${first.date}T${first.start}` : '',
      end_datetime: first.date && first.end ? `${first.date}T${first.end}` : '',
    });
  };

  const removeRow = (i) => setOccurrences(occurrences.filter((_, idx) => idx !== i));

  // Each part is stored independently, so editing one never clears the others.
  const setRowField = (i, key, value) =>
    setOccurrences(occurrences.map((o, idx) => (idx === i ? { ...o, [key]: value } : o)));

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
              onChange={(e) => handleStartChange(e.target.value)}
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
              onChange={(e) => handleEndChange(e.target.value)}
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
              value={o.date || ''}
              onChange={(e) => setRowField(i, 'date', e.target.value)}
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
              value={o.start || ''}
              onChange={(e) => setRowField(i, 'start', e.target.value)}
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
              value={o.end || ''}
              onChange={(e) => setRowField(i, 'end', e.target.value)}
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
