import { useState } from 'react'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './button'
import { Badge, Pagination, StatCard, Tabs } from './display'
import { Drawer } from './drawer'
import { Modal } from './modal'
import { Input } from './form'

describe('primitivas UI', () => {
  it('Button muestra el atajo kbd y se deshabilita con loading', () => {
    render(
      <Button kbd="F4" loading>
        Cobrar
      </Button>,
    )
    const btn = screen.getByRole('button', { name: /cobrar/i })
    expect(btn).toBeDisabled()
    expect(btn.querySelector('kbd')).toHaveTextContent('F4')
  })

  it('Input con leftIcon/rightSlot conserva el input accesible', () => {
    render(<Input aria-label="Buscar" leftIcon={<svg />} rightSlot="CLP" />)
    expect(screen.getByRole('textbox', { name: 'Buscar' })).toBeInTheDocument()
    expect(screen.getByText('CLP')).toBeInTheDocument()
  })

  it('Badge acepta alias semánticos y punto', () => {
    const { container } = render(
      <Badge tone="danger" dot>
        Vencido
      </Badge>,
    )
    expect(screen.getByText('Vencido')).toBeInTheDocument()
    expect(container.querySelector('span > span[aria-hidden]')).not.toBeNull()
  })

  it('StatCard muestra delta con flecha y texto accesible', () => {
    render(<StatCard label="Ventas" value="$10.000" delta={-3.5} deltaLabel="vs. ayer" sparkline={[1, 2, 3]} />)
    expect(screen.getByText('▼')).toBeInTheDocument()
    expect(screen.getByText('Baja')).toBeInTheDocument()
    expect(screen.getByText(/3,5%/)).toBeInTheDocument()
  })

  it('Tabs se mueve con flechas', async () => {
    function T() {
      const [v, setV] = useState<'a' | 'b'>('a')
      return (
        <Tabs
          value={v}
          onChange={setV}
          items={[
            { value: 'a', label: 'Lotes' },
            { value: 'b', label: 'Movimientos' },
          ]}
        />
      )
    }
    render(<T />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'Lotes' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Movimientos' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Pagination navega y respeta límites', async () => {
    const onChange = vi.fn()
    render(<Pagination page={1} pageSize={20} total={45} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('Drawer y Modal cierran con Escape (solo el superior)', async () => {
    const closeDrawer = vi.fn()
    const closeModal = vi.fn()
    render(
      <>
        <Drawer open onClose={closeDrawer} title="Detalle" footer={<button>Ok</button>}>
          contenido
        </Drawer>
        <Modal open onClose={closeModal} title="Confirmar">
          cuerpo
        </Modal>
      </>,
    )
    expect(screen.getByRole('dialog', { name: 'Detalle' })).toBeInTheDocument()
    await act(async () => {
      await userEvent.keyboard('{Escape}')
    })
    expect(closeModal).toHaveBeenCalledTimes(1)
    expect(closeDrawer).not.toHaveBeenCalled()
  })
})
