using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using BTAudioTray;

internal static class Program
{
    static readonly object OutputLock = new();
    static Socket? socket;
    static CancellationTokenSource? readerCancellation;
    static long generation;
    static void Emit(object message) { lock (OutputLock) Console.WriteLine(JsonSerializer.Serialize(message)); }
    static void Close()
    {
        Interlocked.Increment(ref generation);
        readerCancellation?.Cancel(); readerCancellation?.Dispose(); readerCancellation = null;
        socket?.Dispose(); socket = null;
    }
    [STAThread]
    static void Main()
    {
        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            if (line.Length > 8192) continue;
            int id = 0;
            try
            {
                using var doc = JsonDocument.Parse(line); var request = doc.RootElement;
                id = request.GetProperty("id").GetInt32(); var method = request.GetProperty("method").GetString();
                object result = new { };
                switch (method)
                {
                    case "list": result = Paired.List(includeAudioState: true); break;
                    case "connect":
                    {
                        if (request.GetProperty("channel").GetInt32() != 8) throw new Exception("Only the QC45 settings channel is supported.");
                        var address = request.GetProperty("address").GetString()!;
                        var device = Paired.Find(address);
                        if (request.TryGetProperty("existingOnly", out var existingOnly) && existingOnly.GetBoolean() && !device.connected && Endpoint(device)?.IsConnected != true) throw new Exception("The existing headphone connection is no longer available.");
                        Close();
                        // AF_BTH = 32, SOCK_STREAM = 1, BTHPROTO_RFCOMM = 3.
                        var candidate = new Socket((AddressFamily)32, SocketType.Stream, (ProtocolType)3);
                        // ConnectEx is not available on every Bluetooth provider. Use Winsock's
                        // ordinary connect on a worker, bounded by disposal on timeout.
                        try { Task.Run(() => candidate.Connect(new BluetoothEndpoint(address, 8))).WaitAsync(TimeSpan.FromSeconds(18)).GetAwaiter().GetResult(); }
                        catch { candidate.Dispose(); throw new Exception("Could not connect to QC45 settings. Turn the headphones on, close the Bose app, and free a multipoint slot if needed."); }
                        candidate.SendTimeout = 5000;
                        socket = candidate; readerCancellation = new CancellationTokenSource();
                        var token = readerCancellation.Token; var epoch = generation;
                        _ = Task.Run(async () =>
                        {
                            var buffer = new byte[2048];
                            try
                            {
                                while (!token.IsCancellationRequested)
                                {
                                    int count = await candidate.ReceiveAsync(buffer, SocketFlags.None, token);
                                    if (count == 0) break;
                                    if (generation == epoch) Emit(new { @event = "data", hex = Convert.ToHexString(buffer.AsSpan(0, count)).ToLowerInvariant() });
                                }
                            }
                            catch (Exception) { }
                            finally { if (generation == epoch) Emit(new { @event = "disconnected" }); }
                        });
                        result = device; break;
                    }
                    case "write":
                    {
                        if (socket is null) throw new Exception("Headphone settings are not connected.");
                        var hex = request.GetProperty("hex").GetString()!;
                        if (hex.Length > 518 || hex.Length % 2 != 0) throw new Exception("Invalid headphone packet.");
                        var bytes = Convert.FromHexString(hex); int sent = 0;
                        while (sent < bytes.Length) {
                            int count = socket.Send(bytes, sent, bytes.Length - sent, SocketFlags.None);
                            if (count <= 0) throw new Exception("The headphone connection closed while sending.");
                            sent += count;
                        }
                        break;
                    }
                    case "close": Close(); break;
                    case "disconnect":
                    {
                        var device = Paired.Find(request.GetProperty("address").GetString()!); Close();
                        var endpoint = Endpoint(device);
                        if (endpoint != null && !BluetoothManager.Disconnect(endpoint.EndpointId)) throw new Exception("Windows could not disconnect audio. Use Bluetooth settings.");
                        break;
                    }
                    case "reconnectAudio":
                    {
                        var device = Paired.Find(request.GetProperty("address").GetString()!);
                        var endpoint = Endpoint(device) ?? throw new Exception("No headphone audio endpoint yet. Pair the headphones in Windows Bluetooth settings.");
                        if (!endpoint.IsConnected && !BluetoothManager.Connect(endpoint.EndpointId)) throw new Exception("Windows could not start audio. Connect through Bluetooth settings.");
                        break;
                    }
                    case "audioStatus": case "selectOutput": case "volume":
                    {
                        var device = Paired.Find(request.GetProperty("address").GetString()!);
                        var endpoint = Endpoint(device);
                        if (method == "selectOutput")
                        {
                            if (endpoint == null || !endpoint.IsConnected) throw new Exception("Headphone audio is not ready. Choose your headphones in Sound settings.");
                            AudioManager.SetDefaultRenderEndpoint(endpoint.EndpointId);
                        }
                        if (method == "volume" && (endpoint == null || !endpoint.IsConnected)) throw new Exception("Headphone audio is not connected.");
                        var volume = AudioManager.ReadVolume(endpoint?.IsConnected == true ? endpoint.EndpointId : null, method == "volume" ? request.GetProperty("value").GetInt32() : null);
                        var defaultId = AudioManager.GetDefaultRenderEndpointId();
                        result = new { available = endpoint?.IsConnected ?? false, isDefault = endpoint != null && endpoint.IsConnected && defaultId == endpoint.EndpointId, name = endpoint?.Name, volume = volume.Volume, volumeWritable = volume.Writable, muted = volume.Muted };
                        break;
                    }
                    default: throw new Exception("Unknown Bluetooth operation.");
                }
                Emit(new { id, result });
            }
            catch (Exception error) { Emit(new { id, error = error.GetBaseException().Message }); }
        }
        Close();
    }
    static BluetoothManager.BtDevice? Endpoint(Paired.Device device)
    {
        return BluetoothManager.MatchDevice(device.name, device.containerId,
            Paired.List().Count(d => d.name.Equals(device.name, StringComparison.OrdinalIgnoreCase)),
            BluetoothManager.GetBluetoothAudioDevices());
    }
}

internal sealed class BluetoothEndpoint(string address, uint channel) : EndPoint
{
    public override AddressFamily AddressFamily => (AddressFamily)32;
    public override SocketAddress Serialize()
    {
        // SOCKADDR_BTH is pack(1): USHORT family, ULONGLONG address, GUID service, ULONG port.
        var serialized = new SocketAddress((AddressFamily)32, 30);
        var number = Convert.ToUInt64(address.Replace(":", "").Replace("-", ""), 16);
        var bytes = BitConverter.GetBytes(number);
        for (int i = 0; i < 8; i++) serialized[2 + i] = bytes[i];
        var port = BitConverter.GetBytes(channel);
        for (int i = 0; i < 4; i++) serialized[26 + i] = port[i];
        return serialized;
    }
    public override EndPoint Create(SocketAddress socketAddress) => this;
}

internal static class Paired
{
    public record Device(string address, string name, bool connected,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? vendorId = null,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? productId = null,
        [property: JsonIgnore] Guid? containerId = null);
    public static Device Find(string address) => List().SingleOrDefault(d => d.address.Equals(address, StringComparison.OrdinalIgnoreCase)) ?? throw new Exception("Pair your headphones in Windows Bluetooth settings first.");
    public static List<Device> List(bool includeAudioState = false)
    {
        var list = new List<Device>();
        var search = new Search { size = Marshal.SizeOf<Search>(), authenticated = true, remembered = true, connected = true, inquiry = false, timeout = 1 };
        var info = new Info { size = Marshal.SizeOf<Info>(), name = "" };
        var handle = BluetoothFindFirstDevice(ref search, ref info);
        if (handle == IntPtr.Zero) return list;
        try
        {
            do
            {
                if (((info.deviceClass >> 8) & 0x1f) == 4 || info.name.Contains("bose", StringComparison.OrdinalIgnoreCase) || info.name.Equals("Ghost", StringComparison.OrdinalIgnoreCase) || info.name.Contains("airpods", StringComparison.OrdinalIgnoreCase))
                {
                    string raw = info.address.ToString("X12");
                    var identity = DeviceIdentity.Find(raw);
                    list.Add(new Device(string.Join(":", Enumerable.Range(0, 6).Select(i => raw.Substring(i * 2, 2))), info.name, info.connected,
                        identity?.VendorId, identity?.ProductId, identity?.ContainerId));
                }
                info.size = Marshal.SizeOf<Info>();
            } while (BluetoothFindNextDevice(handle, ref info));
        }
        finally { BluetoothFindDeviceClose(handle); }
        if (includeAudioState)
        {
            // Audio endpoints can be active before the Bluetooth enumeration
            // cache reports the connection. Observe that link without routing it.
            try
            {
                var endpoints = BluetoothManager.GetBluetoothAudioDevices();
                list = list.Select(d => d with { connected = d.connected || BluetoothManager.MatchDevice(d.name, d.containerId,
                    list.Count(other => other.name.Equals(d.name, StringComparison.OrdinalIgnoreCase)), endpoints)?.IsConnected == true }).ToList();
            }
            catch (Exception error) { Console.Error.WriteLine($"Windows audio discovery: {error.Message}"); }
        }
        return list;
    }
    [StructLayout(LayoutKind.Sequential)] struct SystemTime { public ushort year, month, dayOfWeek, day, hour, minute, second, milliseconds; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Info
    {
        public int size; public ulong address; public uint deviceClass;
        [MarshalAs(UnmanagedType.Bool)] public bool connected;
        [MarshalAs(UnmanagedType.Bool)] public bool remembered;
        [MarshalAs(UnmanagedType.Bool)] public bool authenticated;
        public SystemTime lastSeen, lastUsed;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string name;
    }
    [StructLayout(LayoutKind.Sequential)] struct Search
    {
        public int size;
        [MarshalAs(UnmanagedType.Bool)] public bool authenticated;
        [MarshalAs(UnmanagedType.Bool)] public bool remembered;
        [MarshalAs(UnmanagedType.Bool)] public bool unknown;
        [MarshalAs(UnmanagedType.Bool)] public bool connected;
        [MarshalAs(UnmanagedType.Bool)] public bool inquiry;
        public byte timeout; public IntPtr radio;
    }
    [DllImport("bthprops.cpl", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr BluetoothFindFirstDevice(ref Search search, ref Info info);
    [DllImport("bthprops.cpl", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool BluetoothFindNextDevice(IntPtr handle, ref Info info);
    [DllImport("bthprops.cpl")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool BluetoothFindDeviceClose(IntPtr handle);
}
