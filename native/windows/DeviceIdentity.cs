using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

// Read the hardware identity Windows cached during pairing. No SDP inquiry or
// Bluetooth connection is made here. Service nodes and the physical device are
// joined by ContainerId, never by a friendly name or a partial MAC address.
internal static class DeviceIdentity
{
    internal record Node(string InstanceId, Guid ContainerId, string[] HardwareIds);
    internal record Identity(Guid ContainerId, int? VendorId, int? ProductId);
    static Dictionary<string, Identity> cached = new(StringComparer.OrdinalIgnoreCase);
    static long refreshed = -5000;
    public static Identity? Find(string address)
    {
        Refresh();
        return cached.GetValueOrDefault(address.Replace(":", "").Replace("-", ""));
    }
    public static bool IsBluetoothContainer(Guid? containerId)
    {
        if (!containerId.HasValue || containerId == Guid.Empty) return false;
        Refresh();
        return cached.Values.Any(identity => identity.ContainerId == containerId);
    }
    static void Refresh()
    {
        if (Environment.TickCount64 - refreshed >= 5000)
        {
            cached = Resolve(ReadNodes());
            refreshed = Environment.TickCount64;
        }
    }

    internal static Dictionary<string, Identity> Resolve(IEnumerable<Node> nodes)
    {
        var result = new Dictionary<string, Identity>(StringComparer.OrdinalIgnoreCase);
        foreach (var group in nodes.Where(n => n.ContainerId != Guid.Empty).GroupBy(n => n.ContainerId))
        {
            var addresses = group.Select(n => Regex.Match(n.InstanceId, @"^BTHENUM\\DEV_([0-9A-F]{12})\\", RegexOptions.IgnoreCase))
                .Where(m => m.Success).Select(m => m.Groups[1].Value).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            if (addresses.Length != 1) continue;
            // Windows prefixes the 16-bit VID with its source: 0001=Bluetooth
            // SIG, 0002=USB. Retain only those documented namespaces.
            var ids = group.SelectMany(n => n.HardwareIds)
                .Select(id => Regex.Match(id, @"^BTHENUM\\\{[0-9A-F-]{36}\}_VID&000[12]([0-9A-F]{4})_PID&([0-9A-F]{4})(?:_|$)", RegexOptions.IgnoreCase))
                .Where(m => m.Success).Select(m => (Vendor: Convert.ToInt32(m.Groups[1].Value, 16), Product: Convert.ToInt32(m.Groups[2].Value, 16)))
                .Distinct().ToArray();
            result[addresses[0]] = ids.Length == 1 ? new(group.Key, ids[0].Vendor, ids[0].Product) : new(group.Key, null, null);
        }
        return result;
    }

    static IEnumerable<Node> ReadNodes()
    {
        var result = new List<Node>();
        // Include installed, disconnected devices so artwork works before connect.
        var set = SetupDiGetClassDevsW(IntPtr.Zero, "BTHENUM", IntPtr.Zero, 4 /* DIGCF_ALLCLASSES */);
        if (set == new IntPtr(-1)) return result;
        try
        {
            for (uint index = 0; ; index++)
            {
                var data = new DeviceInfo { Size = Marshal.SizeOf<DeviceInfo>() };
                if (!SetupDiEnumDeviceInfo(set, index, ref data)) break;
                var instance = new StringBuilder(512);
                if (!SetupDiGetDeviceInstanceIdW(set, ref data, instance, instance.Capacity, out _)) continue;
                var containerKey = new PropertyKey { Format = new("8c7ed206-3f8a-4827-b3ab-ae9e1faefc6c"), Id = 2 };
                var container = new byte[16];
                if (!SetupDiGetDevicePropertyW(set, ref data, ref containerKey, out uint type, container, container.Length, out _, 0) || type != 13 /* GUID */) continue;
                var hardwareKey = new PropertyKey { Format = new("a45c254e-df1c-4efd-8020-67d146a850e0"), Id = 3 };
                SetupDiGetDevicePropertyW(set, ref data, ref hardwareKey, out _, null, 0, out int size, 0);
                string[] ids = [];
                if (size > 0 && size <= 65536)
                {
                    var buffer = new byte[size];
                    if (SetupDiGetDevicePropertyW(set, ref data, ref hardwareKey, out type, buffer, size, out _, 0) && type == 0x2012 /* STRING_LIST */)
                        ids = Encoding.Unicode.GetString(buffer).Split('\0', StringSplitOptions.RemoveEmptyEntries);
                }
                result.Add(new(instance.ToString(), new Guid(container), ids));
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
        return result;
    }

    [StructLayout(LayoutKind.Sequential)] struct DeviceInfo { public int Size; public Guid ClassGuid; public uint DevInst; public UIntPtr Reserved; }
    [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid Format; public uint Id; }
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] static extern IntPtr SetupDiGetClassDevsW(IntPtr classGuid, string enumerator, IntPtr parent, uint flags);
    [DllImport("setupapi.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint index, ref DeviceInfo data);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetupDiGetDeviceInstanceIdW(IntPtr set, ref DeviceInfo data, StringBuilder id, int size, out int required);
    [DllImport("setupapi.dll", ExactSpelling = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetupDiGetDevicePropertyW(IntPtr set, ref DeviceInfo data, ref PropertyKey key, out uint type, [Out] byte[]? buffer, int size, out int required, uint flags);
    [DllImport("setupapi.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
}
