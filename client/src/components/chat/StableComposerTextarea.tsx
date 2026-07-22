import { forwardRef, useRef, type FormEventHandler, type TextareaHTMLAttributes } from "react";

interface StableComposerTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "defaultValue" | "onInput" | "value"> {
  initialValue: string;
  onInput?: FormEventHandler<HTMLTextAreaElement>;
  onValueChange: (value: string) => void;
}

/** Browser-owned textarea: React rerenders never overwrite live text or caret. */
export const StableComposerTextarea = forwardRef<HTMLTextAreaElement, StableComposerTextareaProps>(
  function StableComposerTextarea({
    initialValue,
    onCompositionEnd,
    onCompositionStart,
    onInput,
    onValueChange,
    ...props
  }, ref) {
    const initialValueRef = useRef(initialValue);
    const composingRef = useRef(false);

    return (
      <textarea
        {...props}
        ref={ref}
        defaultValue={initialValueRef.current}
        onCompositionStart={(event) => {
          composingRef.current = true;
          onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          onCompositionEnd?.(event);
          queueMicrotask(() => {
            composingRef.current = false;
          });
        }}
        onInput={(event) => {
          if (!composingRef.current) onValueChange(event.currentTarget.value);
          onInput?.(event);
        }}
      />
    );
  },
);
