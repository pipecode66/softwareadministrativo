export type Role = 'ADMINMASTER' | 'ADMIN_GENERAL' | 'DISENO' | 'IMPRESION' | 'TALLER';
export type WorkStatus = 'NEW' | 'PENDING_ADMIN_REVIEW' | 'IN_PRINTING' | 'IN_WORKSHOP' | 'IN_EXTERNAL' | 'IN_PRODUCTION' | 'PENDING_INSTALLATION' | 'COMPLETED' | 'INSTALLED';
export type PaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'SPECIAL';
export type PaymentMethod = 'EFECTIVO' | 'BANCOLOMBIA' | 'DAVIVIENDA' | 'LEGACY';
export type FinancialRule = 'LEGACY' | 'NEW';
export type DocumentType = 'REM' | 'FACT';
export type Category = 'SuperGiros' | 'Carro Vallas' | 'Proyecto' | 'Otras';
export type Material = 'Panaflex' | 'V. Corte' | 'V. Impresión' | 'Banner';
export type ProductionRoute = 'PRINT_ONLY' | 'IMPRENTA' | 'EXTERNO' | 'WORKSHOP_ONLY' | 'PRINT_WORKSHOP' | 'MULTI_AREA';
export type OrderAction = 'send' | 'finishPrinting' | 'startWorkshop' | 'finishWorkshop' | 'finishExternal' | 'install' | 'close';
export interface User { id: string; name: string; email: string; role: Role; active: boolean; mustChangePassword?: boolean }
export interface Client { id: string; name: string; identification: string; phone: string; specialPayment?: boolean; createdAt: string }
export interface Printing { material: Material; length: number; width: number }
export interface Payment { id: string; date: string; amount: number; recordedBy: string; method?: PaymentMethod }
export type WorkArea = 'DESIGN' | 'PRINTING' | 'WORKSHOP' | 'EXTERNAL';
export type PrintingType = 'PRINT' | 'LASER';
export interface ProductMaterial extends Printing { id?: string; areaM2?: number; consumedAt?: string | null }
export interface OrderActivity {
  id?: string; orderId?: string; orderNumber?: number; productId?: string; productPosition?: number;
  productDescription?: string; position?: number; area: WorkArea;
  status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'; assignedUserId?: string | null;
  ready?: boolean; startedAt?: string | null; completedAt?: string | null;
  materials?: ProductMaterial[]; printingType?: PrintingType;
  laserMinutes?: number | null; laserRate?: number; laserCharge?: number;
}
export interface OrderProduct {
  id?: string; position?: number; description: string; quantity: number; unitValue?: number;
  lineTotal?: number; materials: ProductMaterial[]; activities: OrderActivity[];
}
export type OrderProductInput = OrderProduct & { unitValue: number };
export interface WorkOrder {
  id: string; number: number; clientId: string; description: string; value: number;
  documentType: DocumentType; category: Category; route: ProductionRoute;
  requiresInstallation: boolean; status: WorkStatus; createdBy: string;
  createdAt: string; updatedAt: string; version?: number; printing?: Printing; financialRule?: FinancialRule;
  specialPayment?: boolean; certificates?: { reteFuente: boolean; reteIva: boolean; ica: boolean };
  products?: OrderProduct[];
  /** Set only on an order returned by the server after its role checks. */
  serverVisible?: boolean;
  reteFuente: number; reteIva: number; ica: number; payments: Payment[];
  printingCompletedAt?: string; workshopStartedAt?: string; readyForInstallationAt?: string; installedAt?: string;
  installationNote?: string; closedAt?: string;
}
export type OrderInput = Pick<WorkOrder, 'number' | 'clientId' | 'description' | 'value' | 'documentType' | 'category' | 'route' | 'requiresInstallation' | 'printing' | 'reteFuente' | 'reteIva' | 'ica'> & {
  initialPayment?: { date: string; amount: number; method: Exclude<PaymentMethod, 'LEGACY'> };
  products?: OrderProductInput[];
};
export interface AppData { version: 1; users: User[]; clients: Client[]; orders: WorkOrder[] }
export interface DateRange { from: string; to: string }
export interface Financials { base: number; iva: number; gross: number; retentions: number; collectible: number; paid: number; balance: number; paymentStatus: PaymentStatus }
