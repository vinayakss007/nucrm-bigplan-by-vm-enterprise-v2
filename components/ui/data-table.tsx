"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  useReactTable,
  type SortingState,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { confirmThen } from './confirm-dialog'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Settings2,
  Search,
  X,
} from "lucide-react"

export { ColumnDef }

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  total?: number
  loading?: boolean
  pageSize?: number
  onPageSizeChange?: (size: number) => void
  globalFilter?: string
  onGlobalFilterChange?: (filter: string) => void
  enableRowSelection?: boolean
  onRowSelectionChange?: (selection: RowSelectionState) => void
  enableBulkActions?: boolean
  bulkActions?: BulkAction[]
  emptyState?: EmptyStateProps
  searchPlaceholder?: string
  enableColumnVisibility?: boolean
  enableSearch?: boolean
  enablePagination?: boolean
  manualPagination?: boolean
  pageIndex?: number
  onPaginationChange?: (page: number) => void
}

export interface BulkAction {
  id: string
  label: string
  icon?: React.ReactNode
  onClick: (selectedRowIds: string[], input?: string) => void | string | Promise<void | string | undefined> | undefined
  requiresConfirmation?: boolean
  confirmationMessage?: string
  disabled?: boolean
  requiresInput?: boolean
  inputPlaceholder?: string
  requiresSelect?: boolean
  selectOptions?: { value: string; label: string }[]
}

export interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
    icon?: React.ReactNode
  }
}

export function DataTable<TData, TValue>({
  columns,
  data,
  total,
  loading = false,
  pageSize = 20,
  onPageSizeChange,
  globalFilter: externalGlobalFilter,
  onGlobalFilterChange,
  enableRowSelection = false,
  onRowSelectionChange,
  enableBulkActions = false,
  bulkActions = [],
  emptyState,
  searchPlaceholder = "Search...",
  enableColumnVisibility = true,
  enableSearch = true,
  enablePagination = true,
  manualPagination = false,
  pageIndex: externalPageIndex,
  onPaginationChange,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = React.useState(externalGlobalFilter || "")
  const [columnVisibility, setColumnVisibility] = React.useState({})
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [internalPageIndex, _setInternalPageIndex] = React.useState(0)
  const [internalPageSize, setInternalPageSize] = React.useState(pageSize)
  const [focusedRow, setFocusedRow] = React.useState(-1)
  const [bulkActionInput, setBulkActionInput] = React.useState<Record<string, string>>({})
  const [activeBulkAction, setActiveBulkAction] = React.useState<string | null>(null)
  const tableRef = React.useRef<HTMLDivElement>(null)

  const pageIndex = externalPageIndex ?? internalPageIndex
  const currentPageSize = onPageSizeChange ? pageSize : internalPageSize

  // Handle external filter updates
  React.useEffect(() => {
    if (externalGlobalFilter !== undefined) {
      setGlobalFilter(externalGlobalFilter)
    }
  }, [externalGlobalFilter])

  // Sync focused row with DOM
  React.useEffect(() => {
    const rows = tableRef.current?.querySelectorAll('[data-row-index]');
    rows?.forEach((row, i) => {
      if (i === focusedRow) {
        (row as HTMLElement).focus();
        (row as HTMLElement).setAttribute('data-focused', 'true');
      } else {
        (row as HTMLElement).setAttribute('data-focused', 'false');
      }
    });
  }, [focusedRow, data]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: enablePagination && !manualPagination ? getPaginationRowModel() : undefined,
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: onRowSelectionChange ? (updaterOrValue) => {
      const newValue = typeof updaterOrValue === 'function' ? updaterOrValue(rowSelection) : updaterOrValue
      onRowSelectionChange(newValue)
    } : setRowSelection,
    onGlobalFilterChange: onGlobalFilterChange || setGlobalFilter,
    state: {
      sorting,
      globalFilter: onGlobalFilterChange ? externalGlobalFilter : globalFilter,
      columnVisibility,
      rowSelection,
      pagination: {
        pageIndex: onPaginationChange ? (externalPageIndex ?? 0) : internalPageIndex,
        pageSize: currentPageSize,
      },
    },
    manualPagination,
    rowCount: total ?? data.length,
    enableRowSelection,
    enableMultiRowSelection: enableRowSelection,
  })

  const selectedIds = React.useMemo(() => {
    const selectedRows = table.getFilteredSelectedRowModel().rows
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    return selectedRows.map(row => row.original as any).map(row => row.id || row.id)
  }, [rowSelection, table])

  const handleBulkAction = async (action: BulkAction) => {
    if (action.requiresConfirmation) {
      let proceed = false;
      await confirmThen(
        action.confirmationMessage || `Are you sure you want to ${action.label.toLowerCase()} ${selectedIds.length} items?`,
        async () => { proceed = true; }
      )
      if (!proceed) return
    }

    try {
      const input = action.requiresSelect || action.requiresInput ? bulkActionInput[action.id] : undefined;
      await action.onClick(selectedIds, input)
      // Clear selection after successful action
      table.toggleAllRowsSelected(false)
      setBulkActionInput(prev => { const next = { ...prev }; delete next[action.id]; return next; })
    } catch (error) {
      console.error(`Bulk action "${action.label}" failed:`, error)
    }
  }

  // Loading state - show skeletons
  if (loading) {
    return (
      <div className="w-full space-y-4">
        {(enableSearch || enableBulkActions) && (
          <div className="flex items-center justify-between">
            <Skeleton className="h-10 w-64" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-10 w-32" />
            </div>
          </div>
        )}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      <Skeleton className="h-4 w-24" />
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {Array.from({ length: currentPageSize }).map((_, i) => (
                <TableRow key={i}>
                  {table.getAllColumns().map((_, i) => (
                    <TableCell key={i}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4">
      {/* Toolbar */}
      {(enableSearch || enableBulkActions || enableColumnVisibility) && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto sm:flex-1">
            {enableSearch && (
              <div className="relative w-full sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={searchPlaceholder}
                  value={globalFilter ?? ""}
                  onChange={(e) => {
                    const value = e.target.value
                    setGlobalFilter(value)
                    onGlobalFilterChange?.(value)
                  }}
                  className="pl-9"
                />
                {globalFilter && (
                  <button
                    onClick={() => {
                      setGlobalFilter("")
                      onGlobalFilterChange?.("")
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            {enableBulkActions && selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="info" className="h-8">
                  {selectedIds.length} selected
                </Badge>
                {bulkActions.map((action) => (
                  <div key={action.id} className="flex items-center gap-1">
                    {(action.requiresInput || action.requiresSelect) && activeBulkAction === action.id ? (
                      <>
                        {action.requiresSelect && action.selectOptions ? (
                          <select
                            value={bulkActionInput[action.id] || ''}
                            onChange={(e) => setBulkActionInput(prev => ({ ...prev, [action.id]: e.target.value }))}
                            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          >
                            <option value="">Select...</option>
                            {action.selectOptions.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : action.requiresInput ? (
                          <Input
                            placeholder={action.inputPlaceholder || 'Enter value...'}
                            value={bulkActionInput[action.id] || ''}
                            onChange={(e) => setBulkActionInput(prev => ({ ...prev, [action.id]: e.target.value }))}
                            className="h-8 w-40"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleBulkAction(action)
                            }}
                          />
                        ) : null}
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleBulkAction(action)}
                          disabled={action.disabled || !bulkActionInput[action.id]}
                          className="h-8"
                        >
                          Apply
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setActiveBulkAction(null)
                            setBulkActionInput(prev => { const next = { ...prev }; delete next[action.id]; return next; })
                          }}
                          className="h-8 w-8 p-0"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (action.requiresInput || action.requiresSelect) {
                            setActiveBulkAction(action.id)
                          } else {
                            handleBulkAction(action)
                          }
                        }}
                        disabled={action.disabled}
                        className="h-8"
                      >
                        {action.icon && <span className="mr-2">{action.icon}</span>}
                        {action.label}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {enableColumnVisibility && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">
                    <Settings2 className="h-4 w-4 mr-2" />
                    View
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[150px]">
                  <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {table
                    .getAllColumns()
                    .filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide())
                    .map((column) => {
                      return (
                        <DropdownMenuCheckboxItem
                          key={column.id}
                          className="capitalize"
                          checked={column.getIsVisible()}
                          onCheckedChange={(value) => column.toggleVisibility(!!value)}
                        >
                          {column.id}
                        </DropdownMenuCheckboxItem>
                      )
                    })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {enablePagination && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8">
                    {currentPageSize} / page
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {[10, 20, 30, 50, 100].map((size) => (
                    <DropdownMenuItem
                      key={size}
                      onClick={() => {
                        onPageSizeChange?.(size)
                        setInternalPageSize(size)
                        table.setPageSize(size)
                      }}
                    >
                      {size} / page
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div ref={tableRef} tabIndex={-1} className="rounded-md border overflow-x-auto scrollbar-thin focus:outline-none"
        onKeyDown={(e) => {
          const rows = tableRef.current?.querySelectorAll('[data-row-index]');
          if (!rows?.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setFocusedRow(i => Math.min(i + 1, rows.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusedRow(i => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && focusedRow >= 0) { (rows[focusedRow] as HTMLElement)?.click(); }
        }}>
        <div className="sm:min-w-[600px] min-w-[400px]">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="h-11">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, idx) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  data-row-index={idx}
                  tabIndex={0}
                  className="focus:outline-none focus:bg-accent/50 cursor-pointer"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {emptyState ? (
                    <div className="flex flex-col items-center justify-center py-8">
                      {emptyState.icon && (
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                          {emptyState.icon}
                        </div>
                      )}
                      <h3 className="text-sm font-semibold mb-1">{emptyState.title}</h3>
                      <p className="text-sm text-muted-foreground mb-4">{emptyState.description}</p>
                      {emptyState.action && (
                        <Button onClick={emptyState.action.onClick}>
                          {emptyState.action.icon && (
                            <span className="mr-2">{emptyState.action.icon}</span>
                          )}
                          {emptyState.action.label}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                      <p className="text-sm">No results</p>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Pagination */}
      {enablePagination && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {table.getFilteredRowModel().rows.length} row(s) selected.
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <p className="text-sm font-medium whitespace-nowrap">Rows per page</p>
              <select
                value={currentPageSize}
                onChange={(e) => {
                  const size = Number(e.target.value)
                  onPageSizeChange?.(size)
                  setInternalPageSize(size)
                  table.setPageSize(size)
                }}
                className="h-8 w-[70px] rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {[10, 20, 30, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1 w-full sm:w-auto justify-between sm:justify-start">
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => {
                  if (onPaginationChange) {
                    onPaginationChange(0)
                  } else {
                    table.setPageIndex(0)
                  }
                }}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to first page</span>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => {
                  if (onPaginationChange) {
                    onPaginationChange(pageIndex - 1)
                  } else {
                    table.previousPage()
                  }
                }}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to previous page</span>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-1 text-sm font-medium whitespace-nowrap">
                <span>{table.getState().pagination.pageIndex + 1}/{table.getPageCount()}</span>
              </div>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => {
                  if (onPaginationChange) {
                    onPaginationChange(pageIndex + 1)
                  } else {
                    table.nextPage()
                  }
                }}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to next page</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => {
                  if (onPaginationChange) {
                    onPaginationChange(table.getPageCount() - 1)
                  } else {
                    table.setPageIndex(table.getPageCount() - 1)
                  }
                }}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to last page</span>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper to create sortable column headers
export function createSortableHeader<_TData, _TValue>(
  label: string,
  accessorKey: string
) {
  return {
    accessorKey,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    header: ({ column }: any) => {
      const sortState = column.getIsSorted()
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
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
      )
    },
  }
}
