'use client';

import { ConfirmDialog, useConfirmDialog } from '@/components/ui';
import { getSupabase } from '@/lib/supabase';
import { getSession } from '@/lib/supabase/auth';
import { removeMyDeviceAssignment } from '@/lib/supabase/users';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Device {
  serial_number: string;
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
            provisioning_method,
            created_at,
            webex_polling_enabled,
            devices!inner (
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
          const deviceList: Device[] = assignments.map((d: any) => ({
            serial_number: d.serial_number,
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

  const getStatusColor = (lastSeen: string) => {
    const now = new Date();
    const seen = new Date(lastSeen);
    const diff = now.getTime() - seen.getTime();
    
    if (diff < 5 * 60 * 1000) return 'bg-green-500'; // Online
    if (diff < 30 * 60 * 1000) return 'bg-yellow-500'; // Recently seen
    return 'bg-gray-400 dark:bg-gray-600'; // Offline
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
      const supabase = await getSupabase();
      const { error } = await supabase
        .schema('display')
        .from('user_devices')
        .update({ webex_polling_enabled: !currentValue })
        .eq('serial_number', serialNumber);

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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Manage your LED display devices</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Total Devices</div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white">{summary.total}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Online</div>
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">{summary.online}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Offline</div>
          <div className="text-3xl font-bold text-gray-400 dark:text-gray-500">{summary.offline}</div>
        </div>
      </div>

      {/* Device List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : devices.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No devices yet</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Get started by installing or approving your first LED display.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/user/install"
              className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Install Your First Device
            </Link>
            <Link
              href="/user/approve-device"
              className="inline-block px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Approve Device
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">My Devices</h2>
          {devices.map((device) => (
            <div key={device.serial_number} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(device.device.last_seen)}`} />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {device.device.display_name || device.device.device_id}
                    </h3>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      ({getStatusText(device.device.last_seen)})
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-400 space-y-1">
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
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Enable Webex status sync
                      </span>
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium">
                    {getProvisioningMethodLabel(device.provisioning_method)}
                  </span>
                  <button
                    onClick={() => {
                      setPendingRemoveSerial(device.serial_number);
                      confirmRemove.open();
                    }}
                    className="px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
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
