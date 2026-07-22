import { forwardRef, useRef, type FormEventHandler, type TextareaHTMLAttributes } from "react";

interface StableComposerTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "defaultValue" | "onInput" | "value"> {
  initialValue: string;
  onInput?: FormEventHandler<HTMLTextAreaElement>;
  onValueChange: (value: string) => void;
}

/** Browser-owned textarea: React rerenders never overwrite live text or caret. */
export const StableComposerTextarea = forwardRef<HTMLTextAreaElement, StableComposerTextareaProps>(
  function StableComposerTextarea({ initialValue, onInput, onValueChange, ...props }, ref) {
    const initialValueRef = useRef(initialValue);

    return (
      <textarea
        {...props}
        ref={ref}
        defaultValue={initialValueRef.current}
        onInput={(event) => {
          onValueChange(event.currentTarget.value);
          onInput?.(event);
        }}
      />
    );
  },
);
