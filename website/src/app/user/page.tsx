'use client';

import { ConfirmDialog, useConfirmDialog } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { getSupabase } from '@/lib/supabase';
import { getSession } from '@/lib/supabase/auth';
import { removeMyDeviceAssignment } from '@/lib/supabase/users';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Device {
  serial_number: string;
  device_uuid: string;
  provisioning_method: string;
  created_at: string;
  webex_polling_enabled: boolean;
  device: {
    device_id: string;
    display_name: string | null;
    firmware_version: string | null;
    last_seen: string;
  };
}

interface DeviceSummary {
  total: number;
  online: number;
  offline: number;
}

export default function UserDashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [summary, setSummary] = useState<DeviceSummary>({ total: 0, online: 0, offline: 0 });
  const [loading, setLoading] = useState(true);
  const [pendingRemoveSerial, setPendingRemoveSerial] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const confirmRemove = useConfirmDialog();

  useEffect(() => {
    async function loadDevices() {
      try {
        const { data: { session } } = await getSession();
        
        if (!session) return;

        const supabase = await getSupabase();
        
        // Get user's devices
        const { data: assignments, error } = await supabase
          .schema('display')
          .from('user_devices')
          .select(`
            serial_number,
            device_uuid,
            provisioning_method,
            created_at,
            webex_polling_enabled,
            devices!user_devices_device_uuid_fkey (
              device_id,
              display_name,
              firmware_version,
              last_seen
            )
          `)
          .eq('user_id', session.user.id);

        if (error) {
          console.error('Error loading devices:', error);
          setLoading(false);
          return;
        }

        if (assignments) {
          // Filter out assignments without device_uuid or devices data (legacy/broken assignments)
          const deviceList: Device[] = assignments
            .filter((d: any) => d.device_uuid && d.devices)
            .map((d: any) => ({
              serial_number: d.serial_number,
              device_uuid: d.device_uuid,
              provisioning_method: d.provisioning_method || 'unknown',
              created_at: d.created_at,
              webex_polling_enabled: d.webex_polling_enabled || false,
              device: d.devices
            }));

          setDevices(deviceList);

          // Calculate summary
          const now = new Date();
          const onlineThreshold = 5 * 60 * 1000; // 5 minutes
          
          const online = deviceList.filter((d) => {
            if (!d.device?.last_seen) return false;
            const lastSeen = new Date(d.device.last_seen);
            return now.getTime() - lastSeen.getTime() < onlineThreshold;
          }).length;

          setSummary({
            total: deviceList.length,
            online,
            offline: deviceList.length - online
          });
        }
      } catch (err) {
        console.error('Error loading dashboard:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDevices();
  }, []);

  // Set up realtime subscriptions for user_devices changes
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let userDevicesChannel: any = null;

    async function setupUserDevicesSubscription() {
      const { data: { session } } = await getSession();
      if (!session) return;

      const supabaseClient = await getSupabase();

      // Subscribe to user_devices changes (INSERT/UPDATE/DELETE) for this user
      userDevicesChannel = supabaseClient
        .channel('user-devices-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'display',
            table: 'user_devices',
            filter: `user_id=eq.${session.user.id}`,
          },
          () => {
            // Reload devices when user_devices changes
            async function reload() {
              const { data: { session } } = await getSession();
              if (!session) return;
              const supabase = await getSupabase();
              const { data: assignments } = await supabase
                .schema('display')
                .from('user_devices')
                .select(`
                  serial_number,
                  device_uuid,
                  provisioning_method,
                  created_at,
                  webex_polling_enabled,
                  devices!user_devices_device_uuid_fkey (
                    device_id,
                    display_name,
                    firmware_version,
                    last_seen
                  )
                `)
                .eq('user_id', session.user.id);
              
              if (assignments) {
                // Filter out assignments without device_uuid or devices data
                const deviceList: Device[] = assignments
                  .filter((d: any) => d.device_uuid && d.devices)
                  .map((d: any) => ({
                    serial_number: d.serial_number,
                    device_uuid: d.device_uuid,
                    provisioning_method: d.provisioning_method || 'unknown',
                    created_at: d.created_at,
                    webex_polling_enabled: d.webex_polling_enabled || false,
                    device: d.devices
                  }));
                setDevices(deviceList);
                
                const now = new Date();
                const onlineThreshold = 5 * 60 * 1000;
                const online = deviceList.filter((d) => {
                  if (!d.device?.last_seen) return false;
                  const lastSeen = new Date(d.device.last_seen);
                  return now.getTime() - lastSeen.getTime() < onlineThreshold;
                }).length;
                setSummary({
                  total: deviceList.length,
                  online,
                  offline: deviceList.length - online
                });
              }
            }
            reload();
          }
        )
        .subscribe();
    }

    setupUserDevicesSubscription();

    return () => {
      if (userDevicesChannel) {
        getSupabase().then(supabase => {
          supabase.removeChannel(userDevicesChannel!);
        });
      }
    };
  }, []);

  // Set up realtime subscriptions for device updates (last_seen, etc.)
  useEffect(() => {
    if (devices.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channels: any[] = [];
    let supabaseClientInstance: Awaited<ReturnType<typeof getSupabase>> | null = null;

    async function setupDeviceSubscriptions() {
      supabaseClientInstance = await getSupabase();

      // Subscribe to each device's updates
      devices.forEach(device => {
        const channel = supabaseClientInstance!
          .channel(`device-${device.device_uuid}-updates`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'display',
              table: 'devices',
              filter: `id=eq.${device.device_uuid}`,
            },
            (payload) => {
              // Update the device's data in local state
              setDevices(prev => {
                const updated = prev.map(d => 
                  d.device_uuid === device.device_uuid && payload.new
                    ? {
                        ...d,
                        device: {
                          ...d.device,
                          last_seen: (payload.new as any).last_seen || d.device.last_seen,
                          display_name: (payload.new as any).display_name ?? d.device.display_name,
                          firmware_version: (payload.new as any).firmware_version ?? d.device.firmware_version,
                        }
                      }
                    : d
                );
                
                // Recalculate summary
                const now = new Date();
                const onlineThreshold = 5 * 60 * 1000;
                const online = updated.filter((d) => {
                  if (!d.device?.last_seen) return false;
                  const lastSeen = new Date(d.device.last_seen);
                  return now.getTime() - lastSeen.getTime() < onlineThreshold;
                }).length;
                setSummary({
                  total: updated.length,
                  online,
                  offline: updated.length - online
                });
                
                return updated;
              });
            }
          )
          .subscribe();
        channels.push(channel);
      });
    }

    setupDeviceSubscriptions();

    return () => {
      if (supabaseClientInstance) {
        channels.forEach(channel => {
          supabaseClientInstance!.removeChannel(channel);
        });
      } else {
        // Fallback: get supabase client if not already available
        getSupabase().then(supabase => {
          channels.forEach(channel => {
            supabase.removeChannel(channel);
          });
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices.map(d => d.device_uuid).sort().join(',')]);

  const getStatusColor = (lastSeen: string) => {
    const now = new Date();
    const seen = new Date(lastSeen);
    const diff = now.getTime() - seen.getTime();
    
    if (diff < 5 * 60 * 1000) return 'bg-success'; // Online
    if (diff < 30 * 60 * 1000) return 'bg-warning'; // Recently seen
    return 'bg-[var(--color-text-muted)]'; // Offline
  };

  const getStatusText = (lastSeen: string) => {
    const now = new Date();
    const seen = new Date(lastSeen);
    const diff = now.getTime() - seen.getTime();
    
    if (diff < 5 * 60 * 1000) return 'Online';
    if (diff < 30 * 60 * 1000) return 'Recently seen';
    return 'Offline';
  };

  const getProvisioningMethodLabel = (method: string) => {
    switch (method) {
      case 'pairing_code':
        return 'Pairing Code';
      case 'web_serial':
        return 'Web Install';
      case 'admin_assigned':
        return 'Admin Assigned';
      case 'improv_wifi':
        return 'Improv WiFi';
      default:
        return method || 'Unknown';
    }
  };

  async function handleRemoveDevice() {
    if (!pendingRemoveSerial) return;
    setRemoving(true);
    try {
      await removeMyDeviceAssignment(pendingRemoveSerial);
      // Update local state immediately
      setDevices(prev => prev.filter(d => d.serial_number !== pendingRemoveSerial));
      // Update summary
      setSummary(prev => ({
        ...prev,
        total: prev.total - 1,
        // Recalculate online/offline would require checking which device was removed
        // For simplicity, just decrement total; a page refresh will recalculate
      }));
    } catch (err) {
      console.error('Error removing device:', err);
    } finally {
      setRemoving(false);
      setPendingRemoveSerial(null);
      confirmRemove.close();
    }
  }

  async function handleToggleWebexPolling(serialNumber: string, currentValue: boolean) {
    try {
      const { data: { session } } = await getSession();
      if (!session) {
        console.error('Not authenticated');
        return;
      }
      
      const supabase = await getSupabase();
      const { error } = await supabase
        .schema('display')
        .from('user_devices')
        .update({ webex_polling_enabled: !currentValue })
        .eq('serial_number', serialNumber)
        .eq('user_id', session.user.id);

      if (error) {
        console.error('Error toggling webex polling:', error);
        return;
      }

      // Update local state
      setDevices((prev) => prev.map((d) =>
        d.serial_number === serialNumber
          ? { ...d, webex_polling_enabled: !currentValue }
          : d
      ));
    } catch (err) {
      console.error('Error toggling webex polling:', err);
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Manage your LED display devices</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="p-6">
          <div className="text-sm text-[var(--color-text-muted)] mb-1">Total Devices</div>
          <div className="text-3xl font-bold text-[var(--color-text)]">{summary.total}</div>
        </Card>
        <Card className="p-6">
          <div className="text-sm text-[var(--color-text-muted)] mb-1">Online</div>
          <div className="text-3xl font-bold text-success">{summary.online}</div>
        </Card>
        <Card className="p-6">
          <div className="text-sm text-[var(--color-text-muted)] mb-1">Offline</div>
          <div className="text-3xl font-bold text-[var(--color-text-muted)]">{summary.offline}</div>
        </Card>
      </div>

      {/* Device List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : devices.length === 0 ? (
        <Card className="p-8 text-center">
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-2">No devices yet</h3>
          <p className="text-[var(--color-text-muted)] mb-6">
            Get started by installing or approving your first LED display.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/user/install"
              className="inline-block px-6 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              Install Your First Device
            </Link>
            <Link
              href="/user/approve-device"
              className="inline-block px-6 py-2 bg-[var(--color-surface-alt)] text-[var(--color-text)] rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              Approve Device
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-[var(--color-text)]">My Devices</h2>
          {devices.map((device) => (
            <Card key={device.serial_number} className="p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(device.device.last_seen)}`} />
                    <h3 className="text-lg font-semibold text-[var(--color-text)]">
                      {device.device.display_name || device.device.device_id}
                    </h3>
                    <span className="text-sm text-[var(--color-text-muted)]">
                      ({getStatusText(device.device.last_seen)})
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-[var(--color-text-muted)] space-y-1">
                    <p><span className="font-medium">Serial:</span> {device.serial_number}</p>
                    <p><span className="font-medium">Firmware:</span> {device.device.firmware_version || 'Unknown'}</p>
                    <p><span className="font-medium">Last seen:</span> {new Date(device.device.last_seen).toLocaleString()}</p>
                    <p><span className="font-medium">Added:</span> {new Date(device.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={device.webex_polling_enabled}
                        onChange={() => handleToggleWebexPolling(device.serial_number, device.webex_polling_enabled)}
                        className="w-4 h-4 text-primary rounded focus:ring-primary"
                      />
                      <span className="text-sm text-[var(--color-text)]">
                        Enable Webex status sync
                      </span>
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-[var(--color-surface-alt)] text-[var(--color-text)] rounded-full text-xs font-medium">
                    {getProvisioningMethodLabel(device.provisioning_method)}
                  </span>
                  <Button
                    onClick={() => {
                      setPendingRemoveSerial(device.serial_number);
                      confirmRemove.open();
                    }}
                    variant="danger"
                    size="sm"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove.isOpen}
        onClose={() => {
          confirmRemove.close();
          setPendingRemoveSerial(null);
        }}
        onConfirm={handleRemoveDevice}
        title="Remove Device"
        message={`Remove device ${pendingRemoveSerial} from your account? You can add it back later using the pairing code.`}
        variant="danger"
        confirmLabel="Remove"
        loading={removing}
      />
    </>
  );
}
