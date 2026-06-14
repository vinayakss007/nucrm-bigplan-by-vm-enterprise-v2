'use client';
import { useState, useEffect } from 'react';
import { Plus, Search, Trash2, X, DollarSign, Clock, Package, Building2, User, Users } from 'lucide-react';
import toast from 'react-hot-toast';

interface Service {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  pricingType: string;
  unitPrice: string | null;
  hourlyRate: string | null;
  monthlyPrice: string | null;
  yearlyPrice: string | null;
  isActive: boolean;
  contactId: string | null;
  companyId: string | null;
  createdAt: string;
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

interface Company {
  id: string;
  name: string;
}

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'services' | 'contacts'>('services');
  
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: '',
    pricingType: 'fixed',
    unitPrice: '',
    hourlyRate: '',
    monthlyPrice: '',
    yearlyPrice: '',
    taxRate: '0',
    durationMinutes: '',
    contactId: '',
    companyId: '',
  });

  const [contactForm, setContactForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    jobTitle: '',
  });

  useEffect(() => {
    fetchServices();
    fetchContacts();
    fetchCompanies();
  }, []);

  const fetchServices = async () => {
    try {
      const res = await fetch('/api/tenant/services');
      const data = await res.json();
      setServices(data.services || []);
    } catch (error) {
      console.error('Failed to fetch services', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await fetch('/api/tenant/contacts?limit=500');
      const data = await res.json();
      setContacts(data.data || []);
    } catch (error) {
      console.error('Failed to fetch contacts', error);
    }
  };

  const fetchCompanies = async () => {
    try {
      const res = await fetch('/api/tenant/companies?limit=500');
      const data = await res.json();
      setCompanies(data.data || []);
    } catch (error) {
      console.error('Failed to fetch companies', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingService 
        ? `/api/tenant/services/${editingService.id}` 
        : '/api/tenant/services';
      const method = editingService ? 'PATCH' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          contactId: form.contactId || null,
          companyId: form.companyId || null,
        }),
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save service');
      }
      
      toast.success(editingService ? 'Service updated successfully' : 'Service created successfully');
      setShowModal(false);
      resetForm();
      fetchServices();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      toast.error(error.message || 'Failed to save service');
    }
  };

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServiceId) return;
    
    try {
      const res = await fetch('/api/tenant/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...contactForm,
          jobTitle: contactForm.jobTitle || null,
        }),
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create contact');
      }
      
      const contactData = await res.json();
      const newContactId = contactData.contact?.id || contactData.contact?.data?.id;
      
      if (newContactId) {
        await fetch(`/api/tenant/services/${selectedServiceId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: newContactId }),
        });
        fetchServices();
      }
      
      toast.success('Contact created and linked to service');
      setShowContactModal(false);
      setContactForm({ firstName: '', lastName: '', email: '', phone: '', jobTitle: '' });
      fetchContacts();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      toast.error(error.message || 'Failed to create contact');
    }
  };

  const linkContactToService = async (serviceId: string, contactId: string) => {
    try {
      await fetch(`/api/tenant/services/${serviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      });
      fetchServices();
      toast.success('Contact linked to service');
    } catch {
      toast.error('Failed to link contact');
    }
  };

  const unlinkContact = async (serviceId: string) => {
    try {
      await fetch(`/api/tenant/services/${serviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: null }),
      });
      fetchServices();
      toast.success('Contact unlinked');
    } catch {
      toast.error('Failed to unlink contact');
    }
  };

  const resetForm = () => {
    setForm({
      name: '',
      description: '',
      category: '',
      pricingType: 'fixed',
      unitPrice: '',
      hourlyRate: '',
      monthlyPrice: '',
      yearlyPrice: '',
      taxRate: '0',
      durationMinutes: '',
      contactId: '',
      companyId: '',
    });
    setEditingService(null);
  };

  const openEditModal = (service: Service) => {
    setEditingService(service);
    setForm({
      name: service.name || '',
      description: service.description || '',
      category: service.category || '',
      pricingType: service.pricingType || 'fixed',
      unitPrice: service.unitPrice || '',
      hourlyRate: service.hourlyRate || '',
      monthlyPrice: service.monthlyPrice || '',
      yearlyPrice: service.yearlyPrice || '',
      taxRate: '0',
      durationMinutes: '',
      contactId: service.contactId || '',
      companyId: service.companyId || '',
    });
    setShowModal(true);
  };

  const openContactModal = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setShowContactModal(true);
  };

  const toggleActive = async (service: Service) => {
    try {
      const res = await fetch(`/api/tenant/services/${service.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !service.isActive }),
      });
      if (!res.ok) throw new Error('Failed to update');
      toast.success(service.isActive ? 'Service deactivated' : 'Service activated');
      fetchServices();
    } catch {
      toast.error('Failed to update service');
    }
  };

  const deleteService = async (service: Service) => {
    try {
      const res = await fetch(`/api/tenant/services/${service.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Service deleted');
      fetchServices();
    } catch {
      toast.error('Failed to delete service');
    }
  };

  const filteredServices = services.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  const getContactName = (contactId: string | null) => {
    if (!contactId) return null;
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return null;
    return `${contact.firstName} ${contact.lastName}`.trim();
  };

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return null;
    const company = companies.find(c => c.id === companyId);
    return company?.name || null;
  };

  // Get services that have contacts linked
  const servicesWithContacts = services.filter(s => s.contactId);

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold">Services</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage your service offerings</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-muted rounded-lg p-1 text-xs">
            <button
              onClick={() => setActiveTab('services')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === 'services' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
            >
              Services
            </button>
            <button
              onClick={() => setActiveTab('contacts')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === 'contacts' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
            >
              Contacts ({servicesWithContacts.length})
            </button>
          </div>
        </div>
      </div>

        {activeTab === 'services' && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Search services..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
            </div>

            {loading ? (
              <div className="text-center py-12 text-muted-foreground">Loading...</div>
            ) : filteredServices.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm font-medium">No services found. Create your first service!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredServices.map((service) => (
                  <div key={service.id} className={`admin-card p-4 ${!service.isActive ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-sm truncate">{service.name}</h3>
                        <p className="text-xs text-muted-foreground capitalize">{service.category || 'Uncategorized'}</p>
                      </div>
                      <span className={`px-2 py-1 text-[10px] rounded-full font-medium shrink-0 ml-2 ${service.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                        {service.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{service.description || 'No description'}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                      <span className="flex items-center gap-1"><DollarSign className="w-3 h-3 shrink-0" /> {service.pricingType}</span>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                      {(service as any).durationMinutes && <span className="flex items-center gap-1"><Clock className="w-3 h-3 shrink-0" /> {(service as any).durationMinutes}min</span>}
                    </div>
                    {(service.contactId || service.companyId) && (
                      <div className="text-xs text-muted-foreground mb-3 flex flex-wrap gap-2">
                        {service.contactId && (
                          <span className="flex items-center gap-1"><User className="w-3 h-3 shrink-0" /> <span className="truncate">{getContactName(service.contactId)}</span></span>
                        )}
                        {service.companyId && (
                          <span className="flex items-center gap-1"><Building2 className="w-3 h-3 shrink-0" /> <span className="truncate">{getCompanyName(service.companyId)}</span></span>
                        )}
                      </div>
                    )}
                    <div className="mt-3 pt-3 border-t border-border flex gap-2">
                      <button onClick={() => openEditModal(service)} className="flex-1 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent">
                        Edit
                      </button>
                      <button onClick={() => toggleActive(service)} className="flex-1 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent">
                        {service.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => deleteService(service)} className="px-3 py-1.5 text-xs border border-red-200 dark:border-red-800 text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            <button onClick={() => { resetForm(); setShowModal(true); }} className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 flex items-center gap-2 px-4 py-3 bg-violet-600 text-white rounded-full shadow-lg hover:bg-violet-700 text-sm z-40">
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add Service</span><span className="sm:hidden">Add</span>
            </button>
          </>
        )}

        {activeTab === 'contacts' && (
          <div className="admin-card">
            <div className="p-4 border-b border-border">
              <h2 className="font-semibold text-sm">Contacts linked to Services</h2>
              <p className="text-xs text-muted-foreground">View and manage contacts linked to your services</p>
            </div>
            {servicesWithContacts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="text-sm">No contacts linked to services yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {servicesWithContacts.map(service => {
                  const contact = contacts.find(c => c.id === service.contactId);
                  return (
                    <div key={service.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
                          <User className="w-4 h-4 text-violet-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{contact?.firstName} {contact?.lastName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {contact?.email || contact?.phone || 'No contact info'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 pl-12 sm:pl-0">
                        <span className="text-xs text-muted-foreground">Linked to: <span className="font-medium">{service.name}</span></span>
                        <button 
                          onClick={() => unlinkContact(service.id)}
                          className="text-xs text-red-500 hover:text-red-600 shrink-0"
                        >
                          Unlink
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      {/* Service Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold">{editingService ? 'Edit Service' : 'Add New Service'}</h2>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Service Name *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Pricing Type</label>
                  <select value={form.pricingType} onChange={(e) => setForm({ ...form, pricingType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700">
                    <option value="fixed">Fixed Price</option>
                    <option value="hourly">Hourly Rate</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {form.pricingType === 'fixed' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Unit Price</label>
                    <input type="number" step="0.01" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
                  </div>
                )}
                {form.pricingType === 'hourly' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Hourly Rate</label>
                    <input type="number" step="0.01" value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
                  </div>
                )}
                {form.pricingType === 'monthly' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Monthly Price</label>
                    <input type="number" step="0.01" value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
                  </div>
                )}
                {form.pricingType === 'yearly' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Yearly Price</label>
                    <input type="number" step="0.01" value={form.yearlyPrice} onChange={(e) => setForm({ ...form, yearlyPrice: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Duration (minutes)</label>
                  <input type="number" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Tax Rate (%)</label>
                  <input type="number" step="0.01" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Link to Contact (Optional)</label>
                  <div className="flex gap-2">
                    <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}
                      className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700">
                      <option value="">No contact</option>
                      {contacts.map(c => (
                        <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => openContactModal(editingService?.id || '')} className="px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Link to Company</label>
                  <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700">
                    <option value="">No company</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-4">
                <button type="button" onClick={() => { setShowModal(false); resetForm(); }} className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
                  Cancel
                </button>
                <button type="submit" className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700">
                  {editingService ? 'Update' : 'Create'} Service
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Contact Modal */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold">Create New Contact</h2>
              <button onClick={() => setShowContactModal(false)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateContact} className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">First Name *</label>
                  <input type="text" value={contactForm.firstName} onChange={(e) => setContactForm({ ...contactForm, firstName: e.target.value })} required
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Last Name</label>
                  <input type="text" value={contactForm.lastName} onChange={(e) => setContactForm({ ...contactForm, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone</label>
                <input type="tel" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Job Title</label>
                <input type="text" value={contactForm.jobTitle} onChange={(e) => setContactForm({ ...contactForm, jobTitle: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowContactModal(false)} className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
                  Cancel
                </button>
                <button type="submit" className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700">
                  Create & Link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}