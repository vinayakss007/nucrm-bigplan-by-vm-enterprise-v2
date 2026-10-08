/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
"use client";

// Split out of components/ui/data-table.tsx, which the file-size ratchet
// (#422/#1843) expects to shrink rather than grow.
//
// `SortableColumn` is written out instead of picked off TanStack's Column type:
// react-table v9 constrains its row generic to `RowData`, so the old
// `Pick<Column<unknown, unknown>, …>` no longer type-checks (#2208). Naming the
// two methods this header actually calls also keeps it callable with any
// concretely-typed Column<TData> a consumer passes.
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

type SortableColumn = {
  getIsSorted: () => false | "asc" | "desc";
  toggleSorting: (isDescending?: boolean, autoRemove?: boolean) => void;
};

// Helper to create sortable column headers
export function createSortableHeader(label: string, accessorKey: string) {
  return {
    accessorKey,
    header: ({ column }: { column: SortableColumn }) => {
      const sortState = column.getIsSorted();
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          aria-sort={
            sortState === "asc"
              ? "ascending"
              : sortState === "desc"
                ? "descending"
                : "none"
          }
          className="h-8 p-0 hover:bg-transparent"
        >
          {label}
          {sortState === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : sortState === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4" />
          )}
        </Button>
      );
    },
  };
}
