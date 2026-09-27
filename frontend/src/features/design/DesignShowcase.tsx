import { useState, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle,
  Barcode,
  DollarSign,
  Download,
  Filter,
  Package,
  Pencil,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { Button, IconButton } from '@/components/ui/button'
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  IconTile,
  Kbd,
  MiniStat,
  PageHeader,
  Pagination,
  RowActions,
  Segmented,
  Skeleton,
  SkeletonRows,
  SkeletonText,
  StatCard,
  SummaryRow,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
} from '@/components/ui/display'
import { Checkbox, Field, FormSection, Input, Select, Textarea } from '@/components/ui/form'
import { ConfirmDialog, Modal, ModalActions } from '@/components/ui/modal'
import { DateRange, FilterBar, FilterChip, SearchField } from '@/components/ui/filters'
import { MobileList, MobileListItem, SkeletonList } from '@/components/ui/list'
import { Drawer } from '@/components/ui/drawer'
import { useChartTheme } from '@/lib/chart-theme'
import { clp } from '@/lib/format'

const spark = [12, 18, 14, 22, 19, 27, 24, 31, 29, 35]
const chartData = Array.from({ length: 14 }, (_, i) => ({
  d: `${String(12 + i).padStart(2, '0')}-09`,
  efectivo: 80_000 + Math.round(Math.sin(i / 2) * 40_000 + i * 6_000),
  tarjeta: 60_000 + Math.round(Math.cos(i / 3) * 30_000 + i * 4_000),
}))

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <p className="section-label">{title}</p>
      {children}
    </section>
  )
}

/** Catálogo vivo de primitivas (solo en desarrollo: /design). Referencia para la fase 2. */
export function DesignShowcase() {
  const [tab, setTab] = useState<'lotes' | 'movimientos' | 'ventas'>('lotes')
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d')
  const [page, setPage] = useState(3)
  const [modal, setModal] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [selected, setSelected] = useState(2)
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('2026-09-18')
  const [to, setTo] = useState('2026-09-25')
  const [chip, setChip] = useState(true)
  const ct = useChartTheme()

  return (
    <div className="flex flex-col gap-10 pb-16">
      <PageHeader
        eyebrow="Sistema de diseño"
        title="Primitivas NeoFarma"
        subtitle="Catálogo vivo de componentes en src/components/ui. Ver docs/design-system.md."
        actions={
          <>
            <Button variant="secondary" icon={<Download />}>
              Exportar
            </Button>
            <Button icon={<Plus />} kbd="N">
              Nuevo producto
            </Button>
          </>
        }
      />

      <Section title="Botones">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primario</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="soft">Suave</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="success">Confirmar pago</Button>
          <Button variant="danger" icon={<Trash2 />}>
            Anular
          </Button>
          <Button loading>Guardando</Button>
          <Button disabled>Deshabilitado</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs">XS</Button>
          <Button size="sm">Pequeño</Button>
          <Button size="md">Mediano</Button>
          <Button size="lg" icon={<ShoppingCart />} kbd="F4">
            Cobrar
          </Button>
          <Button variant="secondary" kbd="F2" icon={<Search />}>
            Buscar
          </Button>
          <IconButton label="Editar">
            <Pencil />
          </IconButton>
          <IconButton label="Editar" variant="secondary" size="md">
            <Pencil />
          </IconButton>
          <IconButton label="Eliminar" variant="danger" size="md">
            <Trash2 />
          </IconButton>
          <span className="flex items-center gap-1 text-sm text-muted">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd> abre la paleta
          </span>
        </div>
      </Section>

      <Section title="Formularios">
        <Card className="grid gap-5 p-6 md:grid-cols-2">
          <Field label="Buscar producto" hint="Nombre, principio activo o código de barras">
            {(id) => <Input id={id} leftIcon={<Search />} rightSlot={<Kbd>F2</Kbd>} placeholder="Paracetamol 500 mg" />}
          </Field>
          <Field label="Precio de venta" required error="El precio debe ser mayor a 0">
            {(id) => <Input id={id} invalid rightSlot="CLP" defaultValue="0" />}
          </Field>
          <Field label="Categoría">
            {(id) => (
              <Select id={id}>
                <option>Analgésicos</option>
                <option>Antibióticos</option>
              </Select>
            )}
          </Field>
          <Field label="SKU" labelAction={<button className="font-medium text-brand-700 dark:text-brand-300">Generar</button>}>
            {(id) => <Input id={id} className="font-mono" defaultValue="NF-0042" />}
          </Field>
          <Field label="Observaciones" className="md:col-span-2">
            {(id) => <Textarea id={id} placeholder="Notas para el cierre de caja…" />}
          </Field>
          <div className="flex flex-wrap gap-6 md:col-span-2">
            <Checkbox label="Bioequivalente" defaultChecked />
            <Checkbox label="Requiere receta retenida" description="Se solicitará el N° de receta al vender" />
            <Checkbox label="Deshabilitado" disabled />
          </div>
          <Input inputSize="lg" leftIcon={<Barcode />} placeholder="Escanee el código de barras (lg)" wrapperClassName="md:col-span-2" />
        </Card>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Neutro</Badge>
          <Badge tone="ok" dot>
            Vigente
          </Badge>
          <Badge tone="warn" dot>
            Próximo a vencer
          </Badge>
          <Badge tone="danger" dot>
            Vencido
          </Badge>
          <Badge tone="info">Débito</Badge>
          <Badge tone="rx">Receta simple</Badge>
          <Badge tone="brand">Transferencia</Badge>
          <Badge tone="ok" size="sm">
            sm
          </Badge>
        </div>
      </Section>

      <Section title="Tabs y Segmented">
        <div className="flex flex-wrap items-center gap-4">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'lotes', label: 'Lotes', count: 4 },
              { value: 'movimientos', label: 'Movimientos', count: 12 },
              { value: 'ventas', label: 'Ventas', icon: <Receipt /> },
            ]}
          />
          <Segmented
            aria-label="Rango"
            size="sm"
            value={range}
            onChange={setRange}
            items={[
              { value: '7d', label: '7 días' },
              { value: '30d', label: '30 días' },
              { value: '90d', label: '90 días' },
            ]}
          />
        </div>
      </Section>

      <Section title="KPIs">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Ventas de hoy" value={clp(431_970)} delta={12.4} deltaLabel="vs. ayer" icon={<DollarSign />} sparkline={spark} />
          <StatCard label="Ticket promedio" value={clp(5_328)} delta={-3.1} deltaLabel="vs. ayer" icon={<TrendingUp />} tone="blue" />
          <StatCard
            label="Mermas del mes"
            value={clp(18_400)}
            delta={-22}
            invertDelta
            deltaLabel="vs. mes anterior"
            icon={<Package />}
            tone="amber"
          />
          <StatCard label="Cargando" value="—" loading icon={<Receipt />} tone="violet" />
        </div>
      </Section>

      <Section title="Tabla (hover, fila seleccionada, acciones al hover, skeleton, paginación)">
        <Card className="overflow-hidden">
          <CardHeader
            title="Productos"
            subtitle="342 resultados"
            action={
              <Button size="sm" variant="secondary" icon={<Filter />}>
                Filtros
              </Button>
            }
          />
          <Table containerClassName="max-h-[340px]">
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th>Estado</Th>
                <Th numeric>Stock</Th>
                <Th numeric>Precio</Th>
                <Th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {['Paracetamol 500 mg', 'Amoxicilina 500 mg', 'Losartán 50 mg', 'Ibuprofeno 400 mg'].map((n, i) => (
                <Tr key={n} selected={selected === i} onClick={() => setSelected(i)}>
                  <Td>
                    <p className="font-medium">{n}</p>
                    <p className="font-mono text-xs text-muted">NF-00{i + 1}2</p>
                  </Td>
                  <Td>
                    <Badge tone={i === 1 ? 'danger' : 'ok'} dot>
                      {i === 1 ? 'Vencido' : 'Vigente'}
                    </Badge>
                  </Td>
                  <Td numeric>{(i + 1) * 37}</Td>
                  <Td numeric className="font-semibold">
                    {clp(990 + i * 1500)}
                  </Td>
                  <Td>
                    <RowActions>
                      <IconButton label="Editar">
                        <Pencil />
                      </IconButton>
                    </RowActions>
                  </Td>
                </Tr>
              ))}
              <SkeletonRows rows={3} cols={5} numeric={[2, 3]} />
            </tbody>
          </Table>
          <Pagination page={page} pageSize={20} total={342} onChange={setPage} />
        </Card>
      </Section>

      <Section title="Gráficos (useChartTheme)">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Ventas por día" subtitle="Últimos 14 días · con IVA" bordered={false} />
            <div className="h-64 px-2 pb-4">
              <ResponsiveContainer>
                <AreaChart data={chartData} margin={{ left: 8, right: 16, top: 8 }}>
                  <CartesianGrid {...ct.grid} />
                  <XAxis dataKey="d" {...ct.axis} />
                  <YAxis {...ct.axis} width={56} tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                  <Tooltip {...ct.tooltip} formatter={(v) => clp(Number(v))} />
                  <Area
                    type="monotone"
                    dataKey="efectivo"
                    name="Efectivo"
                    stroke={ct.series[0]}
                    fill={ct.series[0]}
                    fillOpacity={0.1}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <CardHeader title="Medios de pago" subtitle="Efectivo vs. tarjeta" bordered={false} />
            <div className="h-64 px-2 pb-4">
              <ResponsiveContainer>
                <BarChart data={chartData.slice(-7)} margin={{ left: 8, right: 16, top: 8 }} barGap={2}>
                  <CartesianGrid {...ct.grid} />
                  <XAxis dataKey="d" {...ct.axis} />
                  <YAxis {...ct.axis} width={56} tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                  <Tooltip {...ct.tooltip} cursor={ct.barCursor} formatter={(v) => clp(Number(v))} />
                  <Legend {...ct.legend} />
                  <Bar dataKey="efectivo" name="Efectivo" fill={ct.series[0]} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="tarjeta" name="Tarjeta" fill={ct.series[1]} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Estados">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <EmptyState
              icon={<Package />}
              title="Sin productos"
              message="Aún no hay productos que coincidan con la búsqueda."
              action={
                <Button size="sm" icon={<Plus />}>
                  Nuevo producto
                </Button>
              }
            />
          </Card>
          <Card>
            <ErrorState error={new Error('Sin conexión con el servidor')} onRetry={() => {}} />
          </Card>
          <Card className="flex flex-col gap-4 p-6">
            <Skeleton className="h-5 w-1/2" />
            <SkeletonText lines={4} />
          </Card>
        </div>
      </Section>

      <Section title="Barra de filtros (FilterBar · SearchField · DateRange · Segmented · FilterChip)">
        <Card>
          <FilterBar>
            <SearchField placeholder="Buscar por nombre, SKU o código" value={q} onValueChange={setQ} aria-label="Buscar" />
            <DateRange from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
            <Segmented
              aria-label="Estado"
              value={range}
              onChange={setRange}
              className="p-[3px]"
              items={[
                { value: '7d', label: '7 días' },
                { value: '30d', label: '30 días' },
                { value: '90d', label: '90 días' },
              ]}
            />
            <FilterChip active={chip} onClick={() => setChip((v) => !v)} icon={<AlertTriangle />}>
              Stock bajo
            </FilterChip>
          </FilterBar>
          <MobileList className="md:block">
            <MobileListItem onClick={() => {}} aside={<p className="font-semibold tabular-nums">{clp(4990)}</p>}>
              <p className="font-medium text-ink">MobileListItem (lista en móvil)</p>
              <p className="font-mono text-xs text-muted">NF-0029</p>
            </MobileListItem>
            <MobileListItem dimmed aside={<Badge dot>Inactivo</Badge>}>
              <p className="font-medium text-ink">Registro inactivo (dimmed)</p>
            </MobileListItem>
          </MobileList>
          <SkeletonList rows={2} className="md:block" />
        </Card>
      </Section>

      <Section title="Avisos, datos compactos y resúmenes (Callout · MiniStat · SummaryRow · IconTile)">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2.5">
            <Callout tone="danger" title="Venta anulada el 25-09-2026 14:05">
              Motivo: error de digitación
            </Callout>
            <Callout tone="warn">Receta retenida: registre el N° de receta antes de cobrar</Callout>
            <Callout tone="rx" title="Receta N° 12345">
              Dr(a). Pérez
            </Callout>
            <Callout tone="info" compact>
              Aviso compacto para barras de filtros
            </Callout>
          </div>
          <Card className="flex flex-col gap-4 p-5">
            <div className="grid grid-cols-3 gap-2.5">
              <MiniStat label="Precio venta" value={clp(990)} />
              <MiniStat label="Costo neto" value={clp(482)} />
              <MiniStat label="Margen" value="42%" tone="ok" />
            </div>
            <div className="ml-auto w-64 space-y-1.5">
              <SummaryRow label="Neto" value={clp(2084)} />
              <SummaryRow label="IVA 19%" value={clp(396)} />
              <SummaryRow label="Total" value={clp(2480)} strong />
            </div>
            <div className="flex gap-2">
              {(['brand', 'gray', 'ok', 'warn', 'danger', 'info', 'rx'] as const).map((t) => (
                <IconTile key={t} tone={t}>
                  <Package />
                </IconTile>
              ))}
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setModal(true)}>
            Abrir Modal
          </Button>
          <Button variant="secondary" onClick={() => setDrawer(true)}>
            Abrir Drawer
          </Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            ConfirmDialog
          </Button>
        </div>
      </Section>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Registrar egreso de caja"
        description="Queda registrado en el arqueo del turno."
        icon={<DollarSign />}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setModal(false)
          }}
          className="space-y-6"
        >
          <FormSection title="Movimiento" columns={2}>
            <Field label="Monto" required>
              {(id) => <Input id={id} rightSlot="CLP" />}
            </Field>
            <Field label="Tipo">
              {(id) => (
                <Select id={id}>
                  <option>Egreso</option>
                  <option>Ingreso</option>
                </Select>
              )}
            </Field>
          </FormSection>
          <FormSection title="Detalle">
            <Field label="Motivo">{(id) => <Textarea id={id} />}</Field>
          </FormSection>
          {/* ModalActions: pie dentro del <form> (Enter envía), mismo aspecto que la prop footer */}
          <ModalActions start="Enter para registrar">
            <Button variant="secondary" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button type="submit">Registrar</Button>
          </ModalActions>
        </form>
      </Modal>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Amoxicilina 500 mg"
        description="Laboratorio Chile · Cápsulas x 21"
        meta={
          <>
            <span className="font-mono text-xs text-muted">NF-0007</span>
            <Badge tone="rx">Receta simple</Badge>
            <Badge tone="ok" dot>
              108 u.
            </Badge>
          </>
        }
        actions={
          <IconButton label="Editar" size="md">
            <Pencil />
          </IconButton>
        }
        toolbar={
          <Tabs
            size="sm"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'lotes', label: 'Lotes', count: 3 },
              { value: 'movimientos', label: 'Movimientos' },
              { value: 'ventas', label: 'Ventas' },
            ]}
          />
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawer(false)}>
              Cerrar
            </Button>
            <Button icon={<ShoppingCart />}>Vender</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Precio', clp(2990)],
            ['Costo neto', clp(1420)],
            ['Stock vendible', '108 u.'],
            ['Próx. vencimiento', '13-07-2027'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-line bg-subtle/50 p-3.5">
              <p className="text-xs text-muted">{k}</p>
              <p className="mt-1 text-lg font-semibold text-ink tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        <SkeletonText lines={6} className="mt-6" />
      </Drawer>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => setConfirm(false)}
        title="¿Anular la venta #1043?"
        message="El stock de los productos vuelve a sus lotes y la venta queda marcada como anulada. Esta acción no se puede deshacer."
        confirmLabel="Anular venta"
        danger
      />
    </div>
  )
}
