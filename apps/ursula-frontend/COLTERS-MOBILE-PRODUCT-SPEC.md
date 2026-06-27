# Colters Mobile PWA - Product Specification

## Executive Summary

**Product**: Colters Operations Mobile Portal  
**Platform**: Progressive Web App (PWA)  
**Backend**: Ursula existing API/database  
**Target Users**: Production staff, fulfillment team, compliance officers  
**Timeline**: 10 weeks to MVP  

## 1. Product Vision & Scope

### 1.1 Purpose Statement
Colters Mobile is a **fast-operations portal** designed for on-the-go smokehouse tasks. It is intentionally NOT a miniature version of the desktop admin interface.

### 1.2 Core Operations (Mobile Only)
- ✅ Orders due now management
- ✅ Smoking batch checks and temperature logging
- ✅ Culture monitoring and checks
- ✅ Inventory quick updates
- ✅ Compliance checklists
- ✅ Real-time alerts and confirmations

### 1.3 Desktop-Only Operations (Explicit Exclusions)
- ❌ Full system administration
- ❌ Complex reporting and analytics
- ❌ Bulk data operations
- ❌ User management
- ❌ System configuration

## 2. Technical Architecture

### 2.1 Platform Strategy
**Primary**: Responsive PWA  
**Secondary**: Capacitor wrapper (Phase 4+)  

**PWA Benefits**:
- Single codebase for phone/tablet
- Installable native-like experience
- Offline capabilities
- Instant updates
- Lower development cost

### 2.2 Backend Integration
**Source**: Ursula existing backend  
**Database**: Shared PostgreSQL  
**API**: Extended with mobile-specific endpoints  

### 2.3 Technology Stack
```
Frontend: React + TypeScript + TailwindCSS
PWA: Service Worker + Web App Manifest
State: Zustand or Redux Toolkit
API: Fetch/React Query with offline support
Build: Vite
Testing: Jest + React Testing Library
```

## 3. User Roles & Access Control

### 3.1 Role Definitions

#### Admin
- **Access**: Full system access
- **Screens**: All screens + admin dashboard
- **Actions**: Override capabilities, system settings
- **Data**: Full read/write access

#### Production
- **Access**: Smoke operations, cultures, inventory
- **Screens**: Home, Smoke, Cultures, Inventory, Compliance
- **Actions**: Log temps, update batches, record waste
- **Data**: Operational data only

#### Fulfillment
- **Access**: Order management
- **Screens**: Home, Orders, Alerts
- **Actions**: Update order status, customer lookup, handoff
- **Data**: Order and customer data

#### Compliance
- **Access**: Compliance and quality control
- **Screens**: Home, Compliance, Alerts
- **Actions**: Checklists, corrective actions, quality logs
- **Data**: Compliance and audit data

### 3.2 Access Control Matrix

| Screen | Admin | Production | Fulfillment | Compliance |
|--------|-------|------------|-------------|------------|
| Home Dashboard | ✅ | ✅ | ✅ | ✅ |
| Orders | ✅ | ❌ | ✅ | ❌ |
| Smoke | ✅ | ✅ | ❌ | ❌ |
| Cultures | ✅ | ✅ | ❌ | ✅ |
| Inventory | ✅ | ✅ | ❌ | ❌ |
| Compliance | ✅ | ✅ | ❌ | ✅ |
| Alerts | ✅ | ✅ | ✅ | ✅ |

## 4. Core API Specification

### 4.1 Base Configuration
```
Base URL: /api/mobile
Authentication: Bearer JWT
Rate Limiting: 100 req/min per user
Response Format: JSON API specification
```

### 4.2 Dashboard Endpoints

#### GET /api/mobile/dashboard/today
```json
{
  "orders_due": {
    "count": 5,
    "urgent": 2,
    "items": [
      {
        "id": "order-001",
        "customer": "John's Restaurant",
        "due_time": "2024-03-12T14:00:00Z",
        "status": "confirmed",
        "total": 156.92
      }
    ]
  },
  "active_batches": [
    {
      "id": "batch-001",
      "product": "Brisket - 14 Day Dry Age",
      "start_time": "2024-03-12T06:00:00Z",
      "current_stage": "smoking",
      "last_temp": 225,
      "target_temp": 225
    }
  ],
  "culture_checks_due": [
    {
      "id": "culture-001",
      "type": "sourdough",
      "next_check": "2024-03-12T10:00:00Z",
      "current_ph": 3.8
    }
  ],
  "low_stock_alerts": [
    {
      "product_id": "brisket-001",
      "product": "Brisket",
      "current_stock": 15,
      "min_threshold": 20
    }
  ],
  "compliance_due": [
    {
      "id": "checklist-001",
      "type": "daily_safety",
      "due_time": "2024-03-12T09:00:00Z",
      "overdue": true
    }
  ]
}
```

#### GET /api/mobile/alerts
```json
{
  "alerts": [
    {
      "id": "alert-001",
      "type": "order_due",
      "title": "Order #123 due in 30 minutes",
      "message": "John's Restaurant - 2 briskets, 3 racks",
      "action_url": "/orders/123",
      "priority": "high",
      "created_at": "2024-03-12T13:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "total": 15,
    "has_more": true
  }
}
```

### 4.3 Order Management Endpoints

#### GET /api/mobile/orders
Query Parameters:
- `status`: pending|confirmed|preparing|ready|completed
- `due_date`: ISO date string
- `customer_id`: UUID

```json
{
  "orders": [
    {
      "id": "order-001",
      "customer": {
        "id": "cust-001",
        "name": "John's Restaurant",
        "phone": "+1-555-0123"
      },
      "status": "confirmed",
      "due_date": "2024-03-12T14:00:00Z",
      "items": [
        {
          "product_id": "brisket-001",
          "product_name": "Brisket",
          "quantity": 5,
          "unit": "lbs",
          "price": 18.99
        }
      ],
      "total": 156.92,
      "notes": "Extra spice rub on brisket"
    }
  ]
}
```

#### PATCH /api/mobile/orders/:id
```json
{
  "status": "ready",
  "handoff_notes": "Packed in insulated bags",
  "pickup_confirmed": true,
  "pickup_time": "2024-03-12T14:15:00Z"
}
```

### 4.4 Smoking Operations Endpoints

#### GET /api/mobile/smoke/batches
Query Parameters:
- `status`: scheduled|active|cooling|completed
- `product_id`: UUID

```json
{
  "batches": [
    {
      "id": "batch-001",
      "product": {
        "id": "brisket-001",
        "name": "Brisket - 14 Day Dry Age"
      },
      "quantity": 45,
      "status": "active",
      "start_time": "2024-03-12T06:00:00Z",
      "current_stage": "smoking",
      "target_temp": 225,
      "current_temp": 223,
      "wood_type": "hickory",
      "notes": "Extra spice rub applied"
    }
  ]
}
```

#### PATCH /api/mobile/smoke/batches/:id
```json
{
  "current_temp": 225,
  "stage": "smoking",
  "notes": "Temp stable, good smoke ring forming",
  "wood_added": true
}
```

#### POST /api/mobile/logs/temp
```json
{
  "batch_id": "batch-001",
  "temperature": 225,
  "stage": "smoking",
  "notes": "Temp holding steady",
  "recorded_at": "2024-03-12T12:00:00Z"
}
```

### 4.5 Culture Management Endpoints

#### GET /api/mobile/cultures
```json
{
  "cultures": [
    {
      "id": "culture-001",
      "type": "sourdough",
      "batch_id": "batch-004",
      "start_date": "2024-03-10T08:00:00Z",
      "current_stage": "bulk_fermentation",
      "next_check": "2024-03-12T10:00:00Z",
      "last_reading": {
        "ph": 3.8,
        "temp": 78,
        "time": "2024-03-12T08:00:00Z"
      }
    }
  ]
}
```

#### PATCH /api/mobile/cultures/:id
```json
{
  "ph": 3.9,
  "temperature": 78,
  "notes": "Rising well, good activity",
  "check_completed": true
}
```

### 4.6 Inventory Endpoints

#### GET /api/mobile/inventory
Query Parameters:
- `low_stock_only`: boolean
- `product_search`: string

```json
{
  "inventory": [
    {
      "product_id": "brisket-001",
      "product_name": "Brisket",
      "current_quantity": 15,
      "unit": "lbs",
      "min_threshold": 20,
      "last_updated": "2024-03-12T11:30:00Z",
      "status": "low_stock"
    }
  ]
}
```

#### PATCH /api/mobile/inventory/:id
```json
{
  "quantity": 18,
  "adjustment_type": "add",
  "reason": "New batch completed",
  "notes": "14-day dry age batch ready"
}
```

### 4.7 Compliance Endpoints

#### GET /api/mobile/compliance
Query Parameters:
- `status`: pending|due|overdue|completed
- `type`: daily|weekly|monthly

```json
{
  "checklists": [
    {
      "id": "checklist-001",
      "type": "daily_safety",
      "title": "Daily Safety Checklist",
      "due_time": "2024-03-12T09:00:00Z",
      "status": "overdue",
      "items": [
        {
          "id": "item-001",
          "question": "Hand washing stations stocked",
          "type": "pass_fail",
          "required": true
        }
      ]
    }
  ]
}
```

#### POST /api/mobile/compliance/submit
```json
{
  "checklist_id": "checklist-001",
  "responses": [
    {
      "item_id": "item-001",
      "value": "pass",
      "notes": "All stations fully stocked"
    }
  ],
  "photos": [
    {
      "item_id": "item-002",
      "photo_url": "https://api.example.com/photos/xyz.jpg",
      "notes": "Temperature log display"
    }
  ],
  "signature": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "completed_at": "2024-03-12T09:15:00Z"
}
```

## 5. Screen Specifications

### 5.1 Navigation Structure
```
Bottom Navigation (Primary):
├─ Home (Dashboard)
├─ Orders
├─ Smoke
├─ Cultures
├─ Inventory
├─ Compliance
└─ Alerts
```

### 5.2 Home Dashboard

#### Layout
- Header with user role indicator
- Today summary cards (4-6 key metrics)
- Quick action buttons (5 primary actions)
- Recent activity feed
- Pull-to-refresh

#### Key Components
```typescript
interface DashboardData {
  ordersDue: OrderSummary[];
  activeBatches: SmokingBatch[];
  cultureChecks: CultureCheck[];
  lowStockAlerts: StockAlert[];
  complianceItems: ComplianceItem[];
}

interface QuickActions {
  logTemp: () => void;
  markOrderReady: () => void;
  updateStock: () => void;
  addNote: () => void;
  flagIssue: () => void;
}
```

### 5.3 Orders Screen

#### List View
- Filter by status (tabs)
- Search by customer name
- Sort by due date/priority
- Swipe actions for quick updates

#### Detail View
- Customer information
- Order items with quantities
- Status progression buttons
- Handoff notes section
- Pickup/delivery confirmation

### 5.4 Smoke Screen

#### Active Batches List
- Current temperature display
- Stage progress indicator
- Time in current stage
- Quick temp log button

#### Batch Detail
- Temperature history chart
- Stage progression controls
- Wood/fuel logging
- Notes and photos

### 5.5 Cultures Screen

#### Culture List
- Culture type and batch
- Current readings
- Next check due time
- Visual health indicators

#### Culture Detail
- pH and temperature logging
- Visual inspection checklist
- Photo documentation
- Historical trends

### 5.6 Inventory Screen

#### Quick View
- Low stock items only
- Search by product
- Current quantities
- Quick update buttons

#### Update Form
- Quantity adjustment
- Reason codes
- Notes field
- Confirm action

### 5.7 Compliance Screen

#### Checklist List
- Due/overdue status
- Type indicators
- Progress bars
- Quick start buttons

#### Checklist Execution
- Question cards
- Pass/fail toggles
- Photo attachments
- Signature capture
- Submit confirmation

### 5.8 Alerts Screen

#### Alert Feed
- Chronological list
- Priority indicators
- Actionable buttons
- Dismiss options

#### Alert Detail
- Full context
- Direct action links
- Related records
- Resolution tracking

## 6. Mobile UI/UX Guidelines

### 6.1 Design Principles
- **Thumb-first**: All tap targets minimum 44px
- **Status-first**: Critical information prominent
- **Quick-save**: Auto-save where possible
- **Minimal typing**: Use selects, toggles, scans
- **High contrast**: Accessibility first

### 6.2 Component Library
```typescript
// Core Components
- Card (primary container)
- StatusBadge (visual indicators)
- ActionButton (primary actions)
- QuickForm (minimal input)
- ProgressBar (stage progression)
- TempDisplay (large, readable)
- PhotoCapture (camera integration)
- SignaturePad (compliance)
```

### 6.3 Interaction Patterns
- **Pull-to-refresh** on all lists
- **Swipe actions** for quick updates
- **Bottom sheets** for detail views
- **Floating action buttons** for primary actions
- **Modal dialogs** for confirmations
- **Toast notifications** for feedback

### 6.4 Responsive Design
- **Mobile**: 320px - 768px (primary)
- **Tablet**: 768px - 1024px (optimized)
- **Desktop**: 1024px+ (limited support)

## 7. Offline Architecture

### 7.1 Offline Strategy
- **Cache critical data**: Dashboard, active orders, batches
- **Queue actions**: Temp logs, status updates, form submissions
- **Sync on reconnect**: Automatic with conflict resolution
- **Indicators**: Clear sync status display

### 7.2 Local Storage Schema
```typescript
interface OfflineStore {
  dashboard: DashboardData;
  activeOrders: Order[];
  activeBatches: SmokingBatch[];
  pendingActions: QueuedAction[];
  syncStatus: SyncState;
  lastSync: timestamp;
}

interface QueuedAction {
  id: string;
  type: 'temp_log' | 'order_update' | 'compliance_submit';
  payload: any;
  timestamp: number;
  retry_count: number;
}
```

### 7.3 Sync Implementation
```typescript
class SyncManager {
  // Queue actions when offline
  queueAction(action: QueuedAction): void;
  
  // Process queue when online
  processQueue(): Promise<SyncResult>;
  
  // Handle conflicts
  resolveConflict(conflict: SyncConflict): void;
  
  // Background sync
  startBackgroundSync(): void;
}
```

## 8. PWA Configuration

### 8.1 Web App Manifest
```json
{
  "name": "Colters Operations",
  "short_name": "Colters",
  "description": "Smokehouse operations mobile portal",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ea580c",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "categories": ["business", "productivity"],
  "shortcuts": [
    {
      "name": "Log Temperature",
      "short_name": "Temp Log",
      "description": "Quick temperature logging",
      "url": "/smoke/log-temp",
      "icons": [{ "src": "/icons/temp.png", "sizes": "96x96" }]
    }
  ]
}
```

### 8.2 Service Worker Strategy
- **Cache-first** for static assets
- **Network-first** for API calls
- **Cache** critical API responses
- **Background sync** for queued actions

## 9. Security Considerations

### 9.1 Authentication
- JWT tokens with refresh mechanism
- Biometric authentication (Face ID/Touch ID)
- Session timeout (30 minutes inactivity)
- Secure token storage (encrypted)

### 9.2 Data Protection
- HTTPS only (production)
- API request signing
- Sensitive data encryption at rest
- Audit logging for compliance actions

### 9.3 Device Security
- Screen lock requirements
- Remote wipe capability
- Jailbreak/root detection
- App integrity verification

## 10. Performance Requirements

### 10.1 Performance Targets
- **Initial load**: < 3 seconds
- **Interaction response**: < 500ms
- **API response**: < 200ms (95th percentile)
- **Offline sync**: < 30 seconds for typical batch
- **Bundle size**: < 1MB initial, < 2MB total

### 10.2 Optimization Strategies
- Code splitting by route
- Image optimization and lazy loading
- Service worker caching
- Bundle analysis and optimization
- Network request debouncing

## 11. Testing Strategy

### 11.1 Test Coverage
- **Unit tests**: 90%+ coverage
- **Integration tests**: API endpoints
- **E2E tests**: Critical user flows
- **Performance tests**: Load and sync scenarios

### 11.2 Test Scenarios
```typescript
// Critical User Journeys
describe('Order Fulfillment', () => {
  it('should view due orders');
  it('should update order status');
  it('should add handoff notes');
  it('should confirm pickup');
});

describe('Temperature Logging', () => {
  it('should log temperature online');
  it('should queue temperature logs offline');
  it('should sync queued logs on reconnect');
});

describe('Compliance Checklists', () => {
  it('should load active checklists');
  it('should record responses');
  it('should attach photos');
  it('should capture signature');
});
```

## 12. Success Metrics & KPIs

### 12.1 User Adoption Metrics
- **Daily Active Users**: 80% of target staff within 4 weeks
- **Session Duration**: 2-10 minutes average
- **Task Completion Rate**: > 95% for core flows
- **Feature Adoption**: All core flows used weekly

### 12.2 Operational Impact Metrics
- **Order Fulfillment Time**: -25% reduction
- **Temperature Logging Compliance**: +40% improvement
- **Inventory Accuracy**: +30% improvement
- **Compliance Completion Rate**: +50% improvement

### 12.3 Technical Performance Metrics
- **Uptime**: 99.5% availability
- **API Response Time**: < 200ms average
- **Offline Sync Success**: > 98% success rate
- **Crash Rate**: < 0.1% of sessions

## 13. Implementation Timeline

### Phase 1: Foundation (Weeks 1-2)
- [ ] Mobile scope documentation
- [ ] API contract definition
- [ ] PWA project setup
- [ ] Authentication integration
- [ ] Role-based access control

### Phase 2: Core MVP (Weeks 3-5)
- [ ] Home dashboard implementation
- [ ] Orders flow development
- [ ] Smoke flow development
- [ ] Compliance flow development
- [ ] Basic alerts system

### Phase 3: Operational Depth (Weeks 5-7)
- [ ] Cultures flow implementation
- [ ] Inventory quick updates
- [ ] Offline mode implementation
- [ ] Sync functionality
- [ ] Enhanced notifications

### Phase 4: Efficiency Features (Weeks 7-9)
- [ ] QR code scanning
- [ ] Push notifications
- [ ] Photo attachments
- [ ] Role-tuned dashboards
- [ ] Advanced search

### Phase 5: Polish & Analytics (Weeks 9-10)
- [ ] Analytics widgets
- [ ] Voice notes (optional)
- [ ] Performance optimization
- [ ] Cross-platform testing
- [ ] Production deployment

## 14. Risk Mitigation

### 14.1 Technical Risks
- **Offline sync complexity**: Mitigate with thorough testing
- **PWA compatibility**: Test on target devices early
- **Performance degradation**: Monitor and optimize continuously
- **Security vulnerabilities**: Regular security audits

### 14.2 User Adoption Risks
- **Resistance to change**: Include users in design process
- **Training requirements**: Create comprehensive documentation
- **Device compatibility**: Provide device recommendations
- **Connectivity issues**: Robust offline functionality

## 15. Next Steps

### Immediate Actions (Week 1)
1. **Finalize mobile scope document** with stakeholder approval
2. **Set up development environment** and CI/CD pipeline
3. **Create API mock server** for frontend development
4. **Design system setup** with mobile components
5. **Begin Phase 1 implementation**

### Success Criteria
- All Phase 1 deliverables completed on time
- Stakeholder approval of MVP scope
- Development team fully onboarded
- Technical architecture validated

---

**Document Status**: Ready for Development  
**Last Updated**: 2024-03-12  
**Version**: 1.0  
**Next Review**: 2024-03-19 (Phase 1 completion)
