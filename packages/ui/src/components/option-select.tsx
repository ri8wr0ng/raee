import * as React from "react";
import { cn } from "cn";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

export type Option<T extends string = string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
};

type OptionSelectProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  /** Either pass `options`, or `<SelectItem>` children. */
  options?: ReadonlyArray<Option<T>> | undefined;
  children?: React.ReactNode | undefined;
  id?: string | undefined;
  name?: string | undefined;
  disabled?: boolean | undefined;
  placeholder?: React.ReactNode | undefined;
  size?: "sm" | "default" | undefined;
  className?: string | undefined;
  contentClassName?: string | undefined;
  title?: string | undefined;
  /** Lands on the trigger button, e.g. for a dialog's initial focus. */
  ref?: React.Ref<HTMLButtonElement> | undefined;
  "aria-label"?: string | undefined;
  "aria-labelledby"?: string | undefined;
  "aria-describedby"?: string | undefined;
};

/** Labels for the trigger, read from `<SelectItem value>` children. */
function itemsFrom(children: React.ReactNode): Option[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement<{ value?: unknown; children?: React.ReactNode }>(child)) return [];
    if (child.type === React.Fragment) return itemsFrom(child.props.children);
    const { value, children: label } = child.props;
    return typeof value === "string" ? [{ value, label }] : [];
  });
}

/** A shadcn Select with its trigger wired up, for a single string value. */
function OptionSelect<T extends string>({
  value,
  onValueChange,
  options,
  children,
  id,
  name,
  disabled,
  placeholder,
  size = "default",
  className,
  contentClassName,
  title,
  ref,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: OptionSelectProps<T>) {
  const items = options ?? itemsFrom(children);
  return (
    <Select
      items={items}
      value={value}
      name={name}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next as T);
      }}
    >
      <SelectTrigger
        ref={ref}
        id={id}
        size={size}
        title={title}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        className={cn("w-full min-w-0", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className={contentClassName}>
        {options
          ? options.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </SelectItem>
            ))
          : children}
      </SelectContent>
    </Select>
  );
}

export { OptionSelect, SelectItem };
