'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { 
  Users, 
  DollarSign, 
  TrendingUp, 
  MessageSquare,
  Calendar,
  Target,
  Phone,
  Mail,
  CheckCircle,
  Clock,
  AlertCircle,
  BarChart3,
  PieChart,
  Activity,
  Link,
  Send,
  Eye,
  PlusCircle,
  UserPlus,
  Star,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react'

interface Client {
  id: string
  name: string
  email: string
  phone?: string
  company: string
  product: string
  status: 'lead' | 'contacted' | 'kickoff' | 'active' | 'churned'
  value: number
  joinDate: string
  lastContact: string
  nextFollowUp: string
  notes?: string
  avatar?: string
}

interface OutreachTemplate {
  id: string
  name: string
  product: string
  channel: 'linkedin' | 'email' | 'sms'
  template: string
  sentCount: number
  replyRate: number
  conversionRate: number
}

interface Metric {
  label: string
  value: string | number
  change: number
  trend: 'up' | 'down'
}

export default function UrsulaSalesDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'clients' | 'outreach' | 'products' | 'training'>('overview')
  
  const metrics: Metric[] = [
    { label: 'Monthly Revenue', value: '$2,341', change: 23.5, trend: 'up' },
    { label: 'Active Clients', value: 12, change: 2, trend: 'up' },
    { label: 'Pipeline Value', value: '$8,750', change: -5.2, trend: 'down' },
    { label: 'Conversion Rate', value: '12.5%', change: 3.1, trend: 'up' },
  ]

  const clients: Client[] = [
    {
      id: '1',
      name: 'Sarah Chen',
      email: 'sarah@techstart.io',
      company: 'TechStart Solutions',
      product: 'HYDI Pro',
      status: 'active',
      value: 79,
      joinDate: '2024-01-15',
      lastContact: '2024-01-20',
      nextFollowUp: '2024-02-01',
      notes: 'Interested in upgrading to Enterprise'
    },
    {
      id: '2',
      name: 'Mike Rodriguez',
      email: 'mike@localbiz.com',
      company: 'Local Business Co',
      product: 'Lead Pack 25',
      status: 'kickoff',
      value: 99,
      joinDate: '2024-01-18',
      lastContact: '2024-01-19',
      nextFollowUp: '2024-01-22'
    },
    {
      id: '3',
      name: 'Emily Watson',
      email: 'emily@creative.co',
      company: 'Creative Agency',
      product: 'SiteGrade AI Monthly',
      status: 'contacted',
      value: 49,
      joinDate: '2024-01-20',
      lastContact: '2024-01-20',
      nextFollowUp: '2024-01-21'
    }
  ]

  const outreachTemplates: OutreachTemplate[] = [
    {
      id: '1',
      name: 'Lead Packs - LinkedIn',
      product: 'Lead Packs',
      channel: 'linkedin',
      template: 'I noticed you\'re [doing X]. I put together qualified lead lists for businesses like yours — 10 verified leads for $49. Want me to send a sample?',
      sentCount: 45,
      replyRate: 22,
      conversionRate: 8
    },
    {
      id: '2',
      name: 'Payment Processing - LinkedIn',
      product: 'Payment Processing',
      channel: 'linkedin',
      template: 'Saw you\'re selling [product/service]. I built a payment system with Stripe + PayPal smart routing that picks the cheapest processor per transaction. Saves most businesses 15-30% on fees.',
      sentCount: 32,
      replyRate: 18,
      conversionRate: 6
    },
    {
      id: '3',
      name: 'SiteGrade AI - Cold Email',
      product: 'SiteGrade AI',
      channel: 'email',
      template: 'I ran a quick audit on [their site] and found a few things that could improve conversions. Want me to send the full report? It\'s $19 for the detailed version.',
      sentCount: 28,
      replyRate: 25,
      conversionRate: 10
    }
  ]

  const products = [
    { name: 'HYDI Starter', price: '$29/mo', link: 'https://buy.stripe.com/cNicN5b2sgeL71u9ea8IU0c', sales: 3, revenue: 87 },
    { name: 'HYDI Pro', price: '$79/mo', link: 'https://buy.stripe.com/6oU8wP9YobYv0D661Y8IU0d', sales: 5, revenue: 395 },
    { name: 'SiteGrade AI', price: '$49/mo', link: 'https://buy.stripe.com/9B68wP0nOe6D71ucqm8IU0g', sales: 8, revenue: 392 },
    { name: 'Lead Pack 25', price: '$99', link: 'https://buy.stripe.com/28E5kDeeE4w3clO9ea8IU0j', sales: 2, revenue: 198 }
  ]

  const getStatusColor = (status: Client['status']) => {
    switch (status) {
      case 'lead': return 'bg-gray-100 text-gray-800'
      case 'contacted': return 'bg-blue-100 text-blue-800'
      case 'kickoff': return 'bg-yellow-100 text-yellow-800'
      case 'active': return 'bg-green-100 text-green-800'
      case 'churned': return 'bg-red-100 text-red-800'
    }
  }

  const getStatusIcon = (status: Client['status']) => {
    switch (status) {
      case 'lead': return <UserPlus className="w-4 h-4" />
      case 'contacted': return <MessageSquare className="w-4 h-4" />
      case 'kickoff': return <Calendar className="w-4 h-4" />
      case 'active': return <CheckCircle className="w-4 h-4" />
      case 'churned': return <AlertCircle className="w-4 h-4" />
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Ursula Sales Dashboard</h1>
              <p className="text-sm text-gray-500">Client Acquisition & Revenue Management</p>
            </div>
            <div className="flex items-center gap-4">
              <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                <PlusCircle className="w-4 h-4" />
                Add Client
              </button>
              <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                <Send className="w-4 h-4" />
                Quick Outreach
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {[
              { id: 'overview', label: 'Overview', icon: BarChart3 },
              { id: 'clients', label: 'Clients', icon: Users },
              { id: 'outreach', label: 'Outreach', icon: Send },
              { id: 'products', label: 'Products', icon: DollarSign },
              { id: 'training', label: 'Training', icon: Star }
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as any)}
                className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition ${
                  activeTab === id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {metrics.map((metric, idx) => (
                <div key={idx} className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">{metric.label}</p>
                      <p className="text-2xl font-bold text-gray-900 mt-2">{metric.value}</p>
                    </div>
                    <div className={`flex items-center gap-1 text-sm font-medium ${
                      metric.trend === 'up' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {metric.trend === 'up' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                      {Math.abs(metric.change)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue Trend</h3>
                <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg">
                  <BarChart3 className="w-8 h-8 text-gray-400" />
                  <span className="ml-2 text-gray-500">Revenue chart visualization</span>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Sales Funnel</h3>
                <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg">
                  <PieChart className="w-8 h-8 text-gray-400" />
                  <span className="ml-2 text-gray-500">Funnel visualization</span>
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b">
                <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
              </div>
              <div className="p-6 space-y-4">
                {[
                  { icon: CheckCircle, color: 'text-green-600', title: 'New Sale', desc: 'HYDI Pro - Sarah Chen', time: '2 hours ago' },
                  { icon: MessageSquare, color: 'text-blue-600', title: 'Outreach Sent', desc: '15 LinkedIn messages', time: '4 hours ago' },
                  { icon: Calendar, color: 'text-yellow-600', title: 'Kickoff Scheduled', desc: 'Mike Rodriguez - Tomorrow 2PM', time: '6 hours ago' },
                  { icon: DollarSign, color: 'text-green-600', title: 'Payment Received', desc: 'SiteGrade AI - $49', time: '1 day ago' }
                ].map((activity, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <activity.icon className={`w-5 h-5 ${activity.color} mt-0.5`} />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{activity.title}</p>
                      <p className="text-sm text-gray-500">{activity.desc}</p>
                    </div>
                    <span className="text-xs text-gray-400">{activity.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Clients Tab */}
        {activeTab === 'clients' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900">Client Management</h3>
                <div className="flex gap-2">
                  <button className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                    Export
                  </button>
                  <button className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Add Client
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Next Follow-up</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {clients.map((client) => (
                      <tr key={client.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{client.name}</div>
                            <div className="text-sm text-gray-500">{client.company}</div>
                            <div className="text-xs text-gray-400">{client.email}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{client.product}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(client.status)}`}>
                            {getStatusIcon(client.status)}
                            {client.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">${client.value}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{client.nextFollowUp}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex gap-2">
                            <button className="text-blue-600 hover:text-blue-900">
                              <Eye className="w-4 h-4" />
                            </button>
                            <button className="text-gray-600 hover:text-gray-900">
                              <Mail className="w-4 h-4" />
                            </button>
                            <button className="text-gray-600 hover:text-gray-900">
                              <Phone className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Outreach Tab */}
        {activeTab === 'outreach' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900">Outreach Templates</h3>
                <button className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  Create Template
                </button>
              </div>
              <div className="divide-y divide-gray-200">
                {outreachTemplates.map((template) => (
                  <div key={template.id} className="p-6">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h4 className="text-base font-semibold text-gray-900">{template.name}</h4>
                        <div className="flex items-center gap-4 mt-1">
                          <span className="text-sm text-gray-500">Product: {template.product}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${
                            template.channel === 'linkedin' ? 'bg-blue-100 text-blue-800' :
                            template.channel === 'email' ? 'bg-green-100 text-green-800' :
                            'bg-purple-100 text-purple-800'
                          }`}>
                            {template.channel}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">Sent:</span>
                          <span className="ml-1 font-medium">{template.sentCount}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Reply:</span>
                          <span className="ml-1 font-medium text-green-600">{template.replyRate}%</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Conv:</span>
                          <span className="ml-1 font-medium text-blue-600">{template.conversionRate}%</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-700">{template.template}</p>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                        Edit
                      </button>
                      <button className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                        Use Template
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Outreach */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Outreach</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Select Template</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                    <option>Choose a template...</option>
                    {outreachTemplates.map(t => (
                      <option key={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Recipients (one per line)</label>
                  <textarea 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    rows={4}
                    placeholder="Enter email addresses or LinkedIn profiles..."
                  />
                </div>
                <button className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                  Send Outreach
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Products Tab */}
        {activeTab === 'products' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b">
                <h3 className="text-lg font-semibold text-gray-900">Product Performance</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sales</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment Link</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {products.map((product, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                          {product.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-900">
                          {product.price}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-900">
                          {product.sales}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                          ${product.revenue}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <a 
                            href={product.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          >
                            <Link className="w-4 h-4" />
                            View Link
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payment Links Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { category: 'HYDI Tiers', products: ['Starter', 'Pro', 'Enterprise'] },
                { category: 'SiteGrade AI', products: ['Single Report', 'Monthly'] },
                { category: 'Lead Packs', products: ['10 Leads', '25 Leads', '50 Leads'] },
                { category: 'Lead Subscriptions', products: ['20/Month', '50/Month'] },
                { category: 'Payment Processing', products: ['Setup', 'Monthly'] },
                { category: 'AutoStack', products: ['Beta Access'] }
              ].map((category, idx) => (
                <div key={idx} className="bg-white rounded-lg shadow p-4">
                  <h4 className="font-semibold text-gray-900 mb-2">{category.category}</h4>
                  <div className="space-y-1">
                    {category.products.map((product, pidx) => (
                      <div key={pidx} className="text-sm text-gray-600 flex justify-between">
                        <span>{product}</span>
                        <span className="text-gray-400">•</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Training Tab */}
        {activeTab === 'training' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Sales Training Program</h3>
              <div className="prose max-w-none">
                <div className="space-y-6">
                  <section>
                    <h4 className="text-base font-semibold text-gray-900 mb-2">1. First 10 Clients Playbook</h4>
                    <div className="bg-blue-50 rounded-lg p-4">
                      <ul className="space-y-2 text-sm text-gray-700">
                        <li className="flex items-start gap-2">
                          <CheckCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                          <span><strong>Week 1-2:</strong> Warm Network - List 50 contacts, DM 10/day</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                          <span><strong>Week 3-4:</strong> Cold Outreach - 5 communities, provide value</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                          <span><strong>Week 5-8:</strong> Referral Loop - Ask every client</span>
                        </li>
                      </ul>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-base font-semibold text-gray-900 mb-2">2. Outreach Templates</h4>
                    <div className="space-y-3">
                      <div className="border rounded-lg p-3">
                        <div className="text-sm font-medium text-gray-900 mb-1">LinkedIn DM - Lead Packs</div>
                        <p className="text-sm text-gray-600">"I noticed you're [doing X]. I put together qualified lead lists for businesses like yours — 10 verified leads for $49. Want me to send a sample?"</p>
                      </div>
                      <div className="border rounded-lg p-3">
                        <div className="text-sm font-medium text-gray-900 mb-1">LinkedIn DM - Payment Processing</div>
                        <p className="text-sm text-gray-600">"Saw you're selling [product/service]. I built a payment system with Stripe + PayPal smart routing that picks the cheapest processor per transaction. Saves most businesses 15-30% on fees."</p>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-base font-semibold text-gray-900 mb-2">3. Onboarding Process</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border rounded-lg p-3">
                        <div className="text-sm font-medium text-gray-900 mb-1">Immediate (1 Hour)</div>
                        <ul className="text-xs text-gray-600 space-y-1">
                          <li>• Stripe confirmation sent</li>
                          <li>• Personal welcome message</li>
                          <li>• Schedule 15-min kickoff</li>
                        </ul>
                      </div>
                      <div className="border rounded-lg p-3">
                        <div className="text-sm font-medium text-gray-900 mb-1">Kickoff Call (15 min)</div>
                        <ul className="text-xs text-gray-600 space-y-1">
                          <li>• #1 problem (2 min)</li>
                          <li>• Delivery timeline (5 min)</li>
                          <li>• Support contact (2 min)</li>
                          <li>• Q&A (6 min)</li>
                        </ul>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-base font-semibold text-gray-900 mb-2">4. Revenue Targets</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2">Milestone</th>
                            <th className="text-left py-2">MRR</th>
                            <th className="text-left py-2">Clients</th>
                            <th className="text-left py-2">Timeline</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b">
                            <td className="py-2">First dollar</td>
                            <td className="py-2">$29</td>
                            <td className="py-2">1</td>
                            <td className="py-2">This week</td>
                          </tr>
                          <tr className="border-b">
                            <td className="py-2">Rent covered</td>
                            <td className="py-2">$500</td>
                            <td className="py-2">~10</td>
                            <td className="py-2">Month 1</td>
                          </tr>
                          <tr className="border-b">
                            <td className="py-2">Sustainable</td>
                            <td className="py-2">$2,000</td>
                            <td className="py-2">~25</td>
                            <td className="py-2">Month 3</td>
                          </tr>
                          <tr>
                            <td className="py-2">Growing</td>
                            <td className="py-2">$5,000</td>
                            <td className="py-2">~50</td>
                            <td className="py-2">Month 6</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
