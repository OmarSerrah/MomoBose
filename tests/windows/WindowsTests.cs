using BTAudioTray;
using System.Text.Json;

// These tests exercise Windows identity and endpoint selection without invoking
// Windows APIs, so they also run on the Linux CI test job and macOS development.
internal static class WindowsTests
{
    static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    static void Main()
    {
        var container = Guid.NewGuid(); var other = Guid.NewGuid();
        const string address = "001122334455";
        var physical = new DeviceIdentity.Node($@"BTHENUM\DEV_{address}\7&123&0", container, []);
        const string hardwareId = @"BTHENUM\{0000110b-0000-1000-8000-00805f9b34fb}_VID&0001009e_PID&4039";
        var service = new DeviceIdentity.Node(@"BTHENUM\service\7&123&0", container, [hardwareId]);
        var identities = DeviceIdentity.Resolve([physical, service, service with { ContainerId = other }]);
        Check(identities[address] == new DeviceIdentity.Identity(container, 0x009e, 0x4039), "Join hardware identity by physical container");
        Check(identities.Count == 1, "Do not assign identity from unrelated services");
        var noIdentity = DeviceIdentity.Resolve([physical, service with { ContainerId = other }]);
        Check(noIdentity[address].ProductId == null, "Do not guess a product ID");
        var conflict = DeviceIdentity.Resolve([physical, service, service with { HardwareIds = [hardwareId.Replace("4039", "4020")] }]);
        Check(conflict[address].ProductId == null, "Reject contradictory hardware IDs");
        Check(DeviceIdentity.Resolve([physical with { ContainerId = Guid.Empty }, service]).Count == 0, "Ignore empty containers");
        Check(DeviceIdentity.Resolve([physical, physical with { InstanceId = @"BTHENUM\DEV_AABBCCDDEEFF\x" }, service]).Count == 0, "Reject containers shared by multiple addresses");
        var usbId = DeviceIdentity.Resolve([physical, service with { HardwareIds = [hardwareId.Replace("0001009e", "000205a7")] }]);
        Check(usbId[address].VendorId == 0x05a7, "Decode USB vendor ID namespace");
        var unknown = JsonSerializer.Serialize(new Paired.Device("a", "QC45", true));
        Check(!unknown.Contains("productId") && !unknown.Contains("vendorId"), "Omit absent IDs rather than sending null to model detection");

        foreach (var name in new[] { "Headphones (Bose QC45 Stereo)", "Headset (Bose QC45 Hands-Free AG Audio)", "Bose QC45" })
            Check(BluetoothManager.CleanName(name) == "Bose QC45", $"Normalize Windows profile name: {name}");
        Check(BluetoothManager.CleanName("Travel - QC45") == "Travel - QC45", "Preserve a user name containing a dash");
        Check(BluetoothManager.CleanName("Travel (QC45)") == "Travel (QC45)", "Preserve user parentheses");
        var endpoint = new BluetoothManager.BtDevice("qc45", "Ghost", true, container);
        var impostor = new BluetoothManager.BtDevice("other", "Ghost", true, other);
        Check(BluetoothManager.MatchDevice("Ghost", container, 2, [impostor, endpoint]) == endpoint, "Match duplicate names using hardware identity");
        Check(BluetoothManager.MatchDevice("Ghost", null, 2, [impostor, endpoint]) == null, "Refuse ambiguous name-only selection");
        Check(BluetoothManager.MatchDevice("Ghost", container, 1, [impostor]) == null, "Never fall back to a different known container");
        Check(BluetoothManager.MatchDevice("Ghost", null, 1, [endpoint]) == endpoint, "Keep unambiguous name fallback");
        Check(BluetoothManager.MatchDevice("Ghost", container, 1, [endpoint with { IsConnected = false }, endpoint with { EndpointId = "active" }])?.EndpointId == "active", "Prefer the active audio profile");
        Check(BluetoothManager.MatchDevice("Ghost", container, 1, [endpoint, endpoint with { EndpointId = "default", IsDefault = true }])?.EndpointId == "default", "Prefer the system output when both profiles are active");

        if (OperatingSystem.IsWindows())
        {
            var serialized = new BluetoothEndpoint("00:11:22:33:44:55", 8).Serialize();
            Check(serialized.Size == 30 && serialized[2] == 0x55 && serialized[7] == 0 && serialized[26] == 8, "Preserve packed Windows RFCOMM address layout");
            var sonyService = new Guid("956c7b26-d49a-4ba8-b03f-b17d393cb6e2");
            var sonyEndpoint = new BluetoothEndpoint("00:11:22:33:44:55", 0, sonyService);
            var sony = sonyEndpoint.Serialize();
            Check(Enumerable.Range(0, 16).All(i => sony[10 + i] == sonyService.ToByteArray()[i]) && sony[26] == 0, "Resolve Sony RFCOMM by service GUID through SDP");
            Check(((BluetoothEndpoint)sonyEndpoint.Create(sony)).BluetoothAddress == "00:11:22:33:44:55", "Decode native local Bluetooth endpoint without retaining the remote address");
        }
        Console.WriteLine("Windows identity and endpoint selection regression checks passed.");
    }
}
