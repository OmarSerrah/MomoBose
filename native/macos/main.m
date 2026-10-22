#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>
#import <CoreAudio/CoreAudio.h>
#import <math.h>
#import <AppKit/AppKit.h>

// Optional identity getters: SDP records can omit Apple identity on renamed devices.
@interface IOBluetoothDevice (MomoIdentity)
- (unsigned short)vendorID;
- (unsigned short)productID;
@end

// All Bluetooth objects and delegates live on the main run loop. stdin is read separately.
static void Emit(NSDictionary *object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    if (!data) return;
    NSMutableData *line = [data mutableCopy]; [line appendBytes:"\n" length:1];
    [[NSFileHandle fileHandleWithStandardOutput] writeData:line];
}
static NSString *Key(NSString *value) {
    return [[[value lowercaseString] componentsSeparatedByCharactersInSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet]] componentsJoinedByString:@""];
}
static NSException *Failure(NSString *reason) { return [NSException exceptionWithName:@"BluetoothError" reason:reason userInfo:nil]; }
static void Check(OSStatus status, NSString *message) {
    if (status != 0) @throw Failure([NSString stringWithFormat:@"%@ (status %d).", message, status]);
}
static NSString *AudioString(AudioDeviceID device, AudioObjectPropertySelector selector) {
    AudioObjectPropertyAddress property = { selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    CFStringRef string = NULL; UInt32 size = sizeof(string);
    if (AudioObjectGetPropertyData(device, &property, 0, NULL, &size, &string) != 0 || !string) return @"";
    return CFBridgingRelease(string);
}
// Read only the matched headphone endpoint. Never fall back to the default speaker.
static NSDictionary *Volume(AudioDeviceID device, NSNumber *requested) {
    NSMutableArray<NSNumber *> *elements = [NSMutableArray array], *levels = [NSMutableArray array];
    BOOL writable = YES;
    for (UInt32 element = 0; element <= 2; element++) {
        if (element > 0 && elements.count && elements[0].unsignedIntValue == 0) break;
        AudioObjectPropertyAddress property = { kAudioDevicePropertyVolumeScalar, kAudioDevicePropertyScopeOutput, element };
        Float32 level = 0; UInt32 size = sizeof(level); Boolean settable = false;
        if (!AudioObjectHasProperty(device, &property) || AudioObjectGetPropertyData(device, &property, 0, NULL, &size, &level) || !isfinite(level) || level < 0 || level > 1) continue;
        [elements addObject:@(element)]; [levels addObject:@(level)];
        if (AudioObjectIsPropertySettable(device, &property, &settable) || !settable) writable = NO;
    }
    writable = writable && elements.count > 0;
    Float32 maximum = 0;
    for (NSNumber *level in levels) maximum = fmaxf(maximum, level.floatValue);
    AudioObjectPropertyAddress mute = { kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput, kAudioObjectPropertyElementMain };
    UInt32 muted = 0, muteSize = sizeof(muted);
    BOOL hasMute = AudioObjectHasProperty(device, &mute) && AudioObjectGetPropertyData(device, &mute, 0, NULL, &muteSize, &muted) == 0;
    if (requested) {
        if (!writable) @throw Failure(@"Headphone volume is unavailable. Connect the Headphone audio output first.");
        double percent = requested.doubleValue;
        if (!isfinite(percent) || percent < 0 || percent > 100 || floor(percent) != percent) @throw Failure(@"Volume must be between 0 and 100.");
        Float32 target = percent / 100.0;
        for (NSUInteger i = 0; i < elements.count; i++) {
            // Preserve the stereo balance when there are separate channel controls.
            Float32 level = maximum > 0 ? target * levels[i].floatValue / maximum : target;
            AudioObjectPropertyAddress property = { kAudioDevicePropertyVolumeScalar, kAudioDevicePropertyScopeOutput, elements[i].unsignedIntValue };
            Check(AudioObjectSetPropertyData(device, &property, 0, NULL, sizeof(level), &level), @"Could not change headphone volume");
        }
        if (target > 0 && hasMute && muted) {
            Boolean settable = false;
            if (AudioObjectIsPropertySettable(device, &mute, &settable) == 0 && settable) {
                UInt32 unmuted = 0;
                Check(AudioObjectSetPropertyData(device, &mute, 0, NULL, sizeof(unmuted), &unmuted), @"Could not unmute headphones");
            }
        }
        return Volume(device, nil); // Independent endpoint readback, not the requested value.
    }
    return @{ @"volume": elements.count ? @(lroundf(maximum * 100)) : [NSNull null], @"volumeWritable": @(writable), @"muted": hasMute ? (muted != 0 ? @YES : @NO) : [NSNull null] };
}
static NSDictionary *Audio(NSString *address, NSString *name, BOOL select, NSNumber *requestedVolume) {
    AudioObjectPropertyAddress property = { kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    UInt32 size = 0;
    Check(AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &property, 0, NULL, &size), @"Could not read sound outputs");
    NSMutableData *storage = [NSMutableData dataWithLength:size];
    if (size) Check(AudioObjectGetPropertyData(kAudioObjectSystemObject, &property, 0, NULL, &size, storage.mutableBytes), @"Could not read sound outputs");
    AudioDeviceID *devices = storage.mutableBytes, chosen = 0, uidChosen = 0; NSUInteger matches = 0, uidMatches = 0;
    for (UInt32 i = 0; i < size / sizeof(AudioDeviceID); i++) {
        AudioObjectPropertyAddress streams = { kAudioDevicePropertyStreams, kAudioDevicePropertyScopeOutput, kAudioObjectPropertyElementMain };
        UInt32 bytes = 0;
        if (AudioObjectGetPropertyDataSize(devices[i], &streams, 0, NULL, &bytes) || !bytes) continue;
        NSString *uid = AudioString(devices[i], kAudioDevicePropertyDeviceUID);
        NSString *label = AudioString(devices[i], kAudioObjectPropertyName);
        if (Key(address).length == 12 && [Key(uid) containsString:Key(address)]) { uidChosen = devices[i]; uidMatches++; }
        else if (name.length && [label caseInsensitiveCompare:name] == NSOrderedSame) {
            AudioObjectPropertyAddress transport = { kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
            UInt32 kind = 0, transportSize = sizeof(kind);
            if (!AudioObjectGetPropertyData(devices[i], &transport, 0, NULL, &transportSize, &kind) && (kind == kAudioDeviceTransportTypeBluetooth || kind == kAudioDeviceTransportTypeBluetoothLE)) { chosen = devices[i]; matches++; }
        }
    }
    if (uidMatches) { chosen = uidChosen; matches = uidMatches; }
    if (matches != 1) {
        if (select || requestedVolume) @throw Failure(@"Headphone audio output is not ready or is ambiguous. Choose it in Sound settings.");
        return @{ @"available": @NO, @"isDefault": @NO, @"name": [NSNull null], @"volume": [NSNull null], @"volumeWritable": @NO, @"muted": [NSNull null] };
    }
    property.mSelector = kAudioHardwarePropertyDefaultOutputDevice;
    UInt32 outputSize = sizeof(AudioDeviceID); AudioDeviceID actual = 0;
    if (select) Check(AudioObjectSetPropertyData(kAudioObjectSystemObject, &property, 0, NULL, outputSize, &chosen), @"Could not select Headphone audio output");
    Check(AudioObjectGetPropertyData(kAudioObjectSystemObject, &property, 0, NULL, &outputSize, &actual), @"Could not check sound output");
    NSMutableDictionary *result = [@{ @"available": @YES, @"isDefault": (actual == chosen ? @YES : @NO), @"name": AudioString(chosen, kAudioObjectPropertyName) } mutableCopy];
    [result addEntriesFromDictionary:Volume(chosen, requestedVolume)];
    return result;
}

@interface BluetoothHelper : NSObject <IOBluetoothRFCOMMChannelDelegate>
@property(nonatomic, strong) IOBluetoothRFCOMMChannel *channel;
@property(nonatomic, strong) IOBluetoothDevice *device;
@property(nonatomic, strong) NSNumber *connectRequest;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) BOOL existingOnly;
- (void)handle:(NSDictionary *)request;
- (void)close;
@end

@implementation BluetoothHelper
- (void)finish:(NSNumber *)request result:(id)result { Emit(@{ @"id": request, @"result": result ?: @{} }); }
- (void)fail:(NSNumber *)request message:(NSString *)message { Emit(@{ @"id": request, @"error": message ?: @"Bluetooth operation failed." }); }
- (IOBluetoothDevice *)find:(NSString *)address {
    for (IOBluetoothDevice *device in [IOBluetoothDevice pairedDevices]) if ([Key(device.addressString) isEqualToString:Key(address)]) return device;
    @throw Failure(@"Pair your headphones in Bluetooth settings first.");
}
- (NSDictionary *)metadata:(IOBluetoothDevice *)device {
    NSMutableDictionary *result = [@{ @"address": device.addressString ?: @"", @"name": device.name ?: @"Bluetooth headphones", @"connected": @([device isConnected]) } mutableCopy];
    IOBluetoothSDPServiceRecord *record = [device getServiceRecordForUUID:[IOBluetoothSDPUUID uuid16:0x1200]];
    NSNumber *vendor = [[record getAttributeDataElement:0x0201] getNumberValue];
    NSNumber *product = [[record getAttributeDataElement:0x0202] getNumberValue];
    if ([device respondsToSelector:@selector(vendorID)] && device.vendorID) vendor = @(device.vendorID);
    if ([device respondsToSelector:@selector(productID)] && device.productID) product = @(device.productID);
    if (vendor) result[@"vendorId"] = vendor;
    if (product) result[@"productId"] = product;
    if (vendor.unsignedIntValue == 0x004c || vendor.unsignedIntValue == 0x05ac) {
        static NSMutableDictionary *cache; if (!cache) cache = [NSMutableDictionary dictionary];
        NSString *type = @{@0x2002:@"com.apple.airpods", @0x200f:@"com.apple.airpods-gen2", @0x2013:@"com.apple.airpods-gen3", @0x2019:@"com.apple.airpods-gen4", @0x201b:@"com.apple.airpods-gen4", @0x2036:@"com.apple.airpods-gen5", @0x2037:@"com.apple.airpods-gen5", @0x2030:@"com.apple.airpods-gen5", @0x2032:@"com.apple.airpods-gen5", @0x200e:@"com.apple.airpods-pro", @0x2014:@"com.apple.airpods-pro-gen2", @0x2024:@"com.apple.airpods-pro-gen2-2023", @0x2027:@"com.apple.airpods-pro-2025", @0x200a:@"com.apple.airpods-max", @0x201f:@"com.apple.airpods-max-2024", @0x202d:@"com.apple.airpods-max-2"}[product];
        if (type) {
            if (!cache[type]) {
                NSString *resources = @"/System/Library/PrivateFrameworks/CoreBluetoothUI.framework/Versions/A/Resources";
                static NSMutableDictionary *assets;
                if (!assets) {
                    assets = [[NSDictionary dictionaryWithContentsOfFile:[resources stringByAppendingPathComponent:@"AssetPaths.plist"]] mutableCopy] ?: [NSMutableDictionary dictionary];
                    NSArray *files = [[[NSFileManager defaultManager] contentsOfDirectoryAtPath:resources error:nil] sortedArrayUsingSelector:@selector(compare:)];
                    for (NSString *file in files) if ([file hasPrefix:@"AssetPaths-"] && [file hasSuffix:@".plist"]) {
                        NSDictionary *extra = [NSDictionary dictionaryWithContentsOfFile:[resources stringByAppendingPathComponent:file]];
                        if (extra) [assets addEntriesFromDictionary:extra];
                    }
                }
                NSDictionary *asset = assets[[NSString stringWithFormat:@"0x%04X", product.unsignedIntValue]];
                NSString *file = [asset[@"ImageName"] isKindOfClass:[NSString class]] ? asset[@"ImageName"] : nil;
                NSImage *icon = file ? [[NSImage alloc] initWithContentsOfFile:[resources stringByAppendingPathComponent:file.lastPathComponent]] : nil;
                // Render a transparent OS product asset, never a rounded document icon.
                // If this OS predates the model, the renderer uses its vector fallback.
                if (icon) {
                    NSImage *scaled = [[NSImage alloc] initWithSize:NSMakeSize(128, 128)];
                    [scaled lockFocus]; [icon drawInRect:NSMakeRect(0,0,128,128) fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1]; [scaled unlockFocus];
                    NSBitmapImageRep *bitmap = [NSBitmapImageRep imageRepWithData:scaled.TIFFRepresentation];
                    NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
                    if (png) cache[type] = [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]];
                }
            }
            if (cache[type]) result[@"artwork"] = cache[type];
        }
    }
    return result;
}
- (void)close {
    self.generation++;
    if (self.connectRequest) { [self fail:self.connectRequest message:@"Connection cancelled."]; self.connectRequest = nil; }
    IOBluetoothRFCOMMChannel *old = self.channel; self.channel = nil;
    [old setDelegate:nil]; [old closeChannel];
}
- (void)openSettingsChannel {
    NSUInteger generation = self.generation;
    [self.device performSDPQuery:nil];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 800 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        if (self.generation != generation || !self.connectRequest) return;
        if (self.existingOnly && !self.device.isConnected) {
            [self fail:self.connectRequest message:@"The headphones disconnected before controls could be attached."]; self.connectRequest = nil; return;
        }
        IOBluetoothRFCOMMChannel *opened = nil;
        IOReturn status = [self.device openRFCOMMChannelAsync:&opened withChannelID:8 delegate:self];
        if (status) {
            [self fail:self.connectRequest message:[NSString stringWithFormat:@"Could not open QC45 settings (status %d). Close the Bose app, check Bluetooth permission, and retry.", status]];
            self.connectRequest = nil;
        } else self.channel = opened;
    });
}
- (void)connectionComplete:(IOBluetoothDevice *)device status:(IOReturn)status {
    if (device != self.device || !self.connectRequest) return;
    if (status == kIOReturnSuccess || device.isConnected) [self openSettingsChannel];
    else {
        [self fail:self.connectRequest message:[NSString stringWithFormat:@"QC45 is not reachable (status %d). Turn it on, keep it nearby, and free a multipoint slot if two other devices are connected.", status]];
        self.connectRequest = nil;
    }
}
- (void)handle:(NSDictionary *)request {
    NSNumber *requestID = request[@"id"]; NSString *method = request[@"method"];
    if (![requestID isKindOfClass:[NSNumber class]] || ![method isKindOfClass:[NSString class]]) return;
    @try {
        if ([method isEqualToString:@"list"]) {
            NSMutableArray *list = [NSMutableArray array];
            for (IOBluetoothDevice *device in [IOBluetoothDevice pairedDevices]) {
                NSString *name = device.name.lowercaseString ?: @"";
                if (((device.classOfDevice >> 8) & 0x1f) == 4 || [name containsString:@"bose"] || [name containsString:@"ghost"] || [name containsString:@"airpods"]) [list addObject:[self metadata:device]];
            }
            [self finish:requestID result:list];
        } else if ([method isEqualToString:@"connect"]) {
            if (![request[@"address"] isKindOfClass:[NSString class]] || [request[@"channel"] intValue] != 8) @throw Failure(@"Invalid QC45 connection request.");
            [self close]; self.device = [self find:request[@"address"]]; self.existingOnly = [request[@"existingOnly"] boolValue];
            if (self.existingOnly && !self.device.isConnected) @throw Failure(@"The existing headphone connection is no longer available.");
            self.connectRequest = requestID;
            NSUInteger generation = self.generation;
            if (self.device.isConnected) [self openSettingsChannel];
            else {
                IOReturn status = [self.device openConnection:self];
                if (status && !self.device.isConnected) {
                    [self fail:self.connectRequest message:[NSString stringWithFormat:@"Could not start the QC45 connection (status %d). Check Bluetooth access and make sure the headphones are on.", status]];
                    self.connectRequest = nil;
                } else if (status) [self openSettingsChannel];
            }
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 18 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
                if (self.generation != generation || !self.connectRequest) return;
                [self fail:self.connectRequest message:@"Connection timed out. Turn your QC45 on, check Bluetooth permission, and disconnect another device if both slots are occupied."];
                self.connectRequest = nil; [self close];
            });
        } else if ([method isEqualToString:@"write"]) {
            NSString *hex = request[@"hex"];
            if (!self.channel.isOpen || ![hex isKindOfClass:[NSString class]] || hex.length % 2 || hex.length > 518) @throw Failure(@"Headphone settings are not connected.");
            NSMutableData *bytes = [NSMutableData data];
            for (NSUInteger i = 0; i < hex.length; i += 2) {
                unsigned int value = 0; NSScanner *scanner = [NSScanner scannerWithString:[hex substringWithRange:NSMakeRange(i, 2)]];
                if (![scanner scanHexInt:&value] || !scanner.isAtEnd) @throw Failure(@"Invalid headphone packet.");
                uint8_t byte = (uint8_t)value; [bytes appendBytes:&byte length:1];
            }
            Check([self.channel writeSync:bytes.mutableBytes length:(UInt16)bytes.length], @"Could not send headphone setting");
            [self finish:requestID result:@{}];
        } else if ([method isEqualToString:@"close"]) { [self close]; [self finish:requestID result:@{}];
        } else if ([method isEqualToString:@"disconnect"]) {
            IOBluetoothDevice *device = [self find:request[@"address"]]; [self close];
            Check([device closeConnection], @"Could not disconnect headphones"); [self finish:requestID result:@{}];
        } else if ([method isEqualToString:@"reconnectAudio"]) {
            IOBluetoothDevice *device = [self find:request[@"address"]];
            if (!device.isConnected) Check([device openConnection], @"Could not reconnect headphones");
            [self finish:requestID result:@{}];
        } else if ([method isEqualToString:@"audioStatus"] || [method isEqualToString:@"selectOutput"] || [method isEqualToString:@"volume"]) {
            IOBluetoothDevice *device = [self find:request[@"address"]];
            [self finish:requestID result:Audio(device.addressString, device.name, [method isEqualToString:@"selectOutput"], [method isEqualToString:@"volume"] ? request[@"value"] : nil)];
        } else @throw Failure(@"Unknown Bluetooth operation.");
    } @catch (NSException *exception) { [self fail:requestID message:exception.reason]; }
}
- (void)rfcommChannelOpenComplete:(IOBluetoothRFCOMMChannel *)opened status:(IOReturn)status {
    if (!self.connectRequest || (self.channel && self.channel != opened)) { [opened setDelegate:nil]; [opened closeChannel]; return; }
    NSNumber *requestID = self.connectRequest; self.connectRequest = nil;
    if (!status) { self.channel = opened; [self finish:requestID result:[self metadata:self.device]]; }
    else { self.channel = nil; [self fail:requestID message:[NSString stringWithFormat:@"Could not connect to QC45 settings (status %d). Make sure the headphones are on and the Bose app is closed.", status]]; }
}
- (void)rfcommChannelData:(IOBluetoothRFCOMMChannel *)source data:(void *)pointer length:(size_t)length {
    if (source != self.channel || !length || length > 4096) return;
    uint8_t *bytes = pointer; NSMutableString *hex = [NSMutableString stringWithCapacity:length * 2];
    for (size_t i = 0; i < length; i++) [hex appendFormat:@"%02x", bytes[i]];
    Emit(@{ @"event": @"data", @"hex": hex });
}
- (void)rfcommChannelClosed:(IOBluetoothRFCOMMChannel *)source {
    if (source != self.channel) return;
    self.channel = nil; Emit(@{ @"event": @"disconnected" });
}
@end

int main(void) {
    @autoreleasepool {
        BluetoothHelper *helper = [BluetoothHelper new];
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            char *line = NULL; size_t capacity = 0; ssize_t length;
            while ((length = getline(&line, &capacity, stdin)) >= 0) {
                @autoreleasepool {
                    if (length > 8192) continue;
                    NSData *data = [NSData dataWithBytes:line length:length];
                    NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                    if ([request isKindOfClass:[NSDictionary class]]) dispatch_async(dispatch_get_main_queue(), ^{ [helper handle:request]; });
                }
            }
            free(line); dispatch_async(dispatch_get_main_queue(), ^{ [helper close]; exit(0); });
        });
        [[NSRunLoop mainRunLoop] run];
    }
    return 0;
}
