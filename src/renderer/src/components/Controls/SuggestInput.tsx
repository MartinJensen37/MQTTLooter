import { useId, useRef, useState, type KeyboardEvent } from 'react';

export interface Suggestion {
  value: string;
  /** Shown instead of the value, e.g. "Whole payload" for an empty path. */
  label?: string;
}

/**
 * A text field with a suggestion list, styled like the select menus. The list opens on focus,
 * typing or the arrow, filters as you type and works with the arrow keys and Enter. Picking a
 * suggestion calls `onPick`; Enter on typed text calls `onEnter`, so free text still works.
 */
export default function SuggestInput({
  value,
  onChange,
  onPick,
  onEnter,
  onBlur,
  suggestions,
  label,
  placeholder,
  title,
  empty = 'No suggestions',
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (value: string) => void;
  onEnter?: (value: string) => void;
  onBlur?: () => void;
  suggestions: Suggestion[];
  /** Accessible name of the field. */
  label: string;
  placeholder?: string;
  title?: string;
  /** Shown in the open list when nothing matches. */
  empty?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = value.trim().toLowerCase();
  const shown = suggestions.filter(
    (suggestion) =>
      !query ||
      suggestion.value.toLowerCase().includes(query) ||
      (suggestion.label ?? '').toLowerCase().includes(query),
  );
  const pick = (suggestion: Suggestion) => {
    setOpen(false);
    setActive(-1);
    onPick(suggestion.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (!open) setOpen(true);
      setActive((index) => {
        if (!shown.length) return -1;
        if (index < 0) return step > 0 ? 0 : shown.length - 1;
        return (index + step + shown.length) % shown.length;
      });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && shown[active]) pick(shown[active]);
      else {
        setOpen(false);
        onEnter?.(value);
      }
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
    }
  };
  return (
    <div className="suggest-input">
      <input
        ref={input}
        className="form-input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        value={value}
        placeholder={placeholder}
        title={title}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
          onBlur?.();
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="suggest-input-toggle"
        tabIndex={-1}
        aria-label={`Show suggestions for ${label}`}
        disabled={disabled}
        // Keep focus in the field, so the list does not close before it opens.
        onMouseDown={(event) => {
          event.preventDefault();
          if (document.activeElement !== input.current) input.current?.focus();
          else setOpen((previous) => !previous);
        }}
      />
      {open && (
        <ul
          className="suggest-input-list"
          id={listId}
          role="listbox"
          aria-label={label}
          onMouseDown={(event) => event.preventDefault()}
        >
          {shown.length ? (
            shown.map((suggestion, index) => (
              <li
                key={suggestion.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={index === active ? 'active' : undefined}
                title={suggestion.value || suggestion.label}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(suggestion)}
              >
                {suggestion.label ?? suggestion.value}
              </li>
            ))
          ) : (
            <li className="suggest-input-empty" aria-disabled="true">
              {empty}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
