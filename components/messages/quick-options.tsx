"use client";

import { Button } from "@/components/ui/button";

export function QuickOptions({
  options,
  onSelect,
  disabled,
}: {
  options: string[];
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-1" role="group" aria-label="Quick reply options">
      {options.map((option, i) => (
        <Button
          key={`${option}-${i}`}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="rounded-full h-auto py-1.5 px-3.5 text-sm whitespace-normal text-left border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 hover:text-primary"
          onClick={() => onSelect(option)}
        >
          {option}
        </Button>
      ))}
    </div>
  );
}
