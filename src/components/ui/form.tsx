import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

const control =
  'h-9 w-full rounded-md border bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring disabled:opacity-50 aria-[invalid=true]:border-bad';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(control, className)} {...props} />,
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(control, 'h-auto min-h-16 py-2', className)} {...props} />,
);
Textarea.displayName = 'Textarea';

export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(control, 'pr-8', className)} {...props} />,
);
NativeSelect.displayName = 'NativeSelect';

/**
 * A labelled control with an optional hint and error, wired for screen
 * readers: the control is described by both, and marked invalid on error.
 */
export function Field(props: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = props.hint ? `${id}-hint` : undefined;
  const errorId = props.error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', props.className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {props.label}
      </label>
      {props.children({ id, describedBy, invalid: Boolean(props.error) })}
      {props.hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      ) : null}
      {props.error ? (
        <p id={errorId} className="text-xs text-bad" role="alert">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        aria-describedby={props.hint ? `${id}-hint` : undefined}
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {props.label}
        </label>
        {props.hint ? (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {props.hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
