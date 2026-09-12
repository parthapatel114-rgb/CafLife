"use client";
import { useId } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
export function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
}) {
  const id = useId();
  const temporal = ["date", "time", "datetime-local"].includes(props.type ?? "");
  return (
    <div className={"field" + (temporal ? " temporal-field" : "")}>
      <label htmlFor={id}>{label}</label>
      <input id={id} {...props} />
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}
export function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="field">
      <label id={id}>{label}</label>
      <Select value={value} onValueChange={(v) => v && onChange(v)} items={options}>
        <SelectTrigger aria-labelledby={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
