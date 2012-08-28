#import <stdlib.h>
#import <stdio.h>
#import "JSON.h"

static inline short halfword(const unsigned char *s, const unsigned int i) {
	return (s[i] << 8) | s[i+1];
}

static inline int word(const unsigned char *s, const unsigned int i) {
	return (s[i] << 24) | (s[i+1] << 16) | (s[i+2] << 8) | s[i+3];
}

int main (int argc, const char * argv[]) {
    NSAutoreleasePool * pool = [[NSAutoreleasePool alloc] init];
	
	if (argc != 4) {
		fprintf(stderr,"Usage: radarparse <json | plist | bplist> <input_file> <output_file>\n");
		return 1;
	}
	
	NSString *outputMode = [NSString stringWithCString:argv[1] encoding:NSUTF8StringEncoding];
	NSString *outputFilePath = [NSString stringWithCString:argv[3] encoding:NSUTF8StringEncoding];
	
	FILE *f = fopen(argv[2],"rb");
	if (f == NULL) {
		fprintf(stderr,"Error opening file: %s\n",argv[2]);
		return 2;
	}
	
	fseek(f,0,SEEK_END);
	long size = ftell(f);
	rewind(f);
	
	unsigned char *b = (unsigned char *)malloc(sizeof(unsigned char) * size);
	if (b == NULL) {
		fprintf(stderr,"Error allocating memory.\n");
		return 3;
	}
	
	size_t result = fread(b,1,size,f);
	if (result != size) {
		fprintf(stderr,"Error reading file.\n");
		return 4;
	}
	
	fclose(f);
	
	NSMutableDictionary *d = [NSMutableDictionary dictionary];
	
	int i;
	unsigned char wmo[18];
	for (i = 0; i < 18; i++)
		wmo[i] = b[i];
	NSString *wmoHeader = [[NSString alloc] initWithBytes:wmo length:sizeof(wmo) encoding:NSASCIIStringEncoding];
	[d setObject:wmoHeader forKey:@"wmo_header"];
	[wmoHeader release];
	
	unsigned char awips[6];
	for (i = 21; i < 27; i++)
		awips[i - 21] = b[i];
	NSString *awipsID = [[NSString alloc] initWithBytes:awips length:sizeof(awips) encoding:NSASCIIStringEncoding];
	[d setObject:awipsID forKey:@"awips_id"];
	[awipsID release];
	
	[d setObject:[NSNumber numberWithShort:halfword(b,30)] forKey:@"message_code"];
	
	int t = ((halfword(b,32) - 1) * 86400) + word(b,34);
	[d setObject:[NSDate dateWithTimeIntervalSince1970:t] forKey:@"message_time"];
	
	if (word(b,38) != size - 30) {
		fprintf(stderr,"Error verifying file length.\n");
		return 5;
	}
	
	[d setObject:[NSNumber numberWithShort:halfword(b,42)] forKey:@"source_id"];
	
	[d setObject:[NSNumber numberWithShort:halfword(b,44)] forKey:@"destination_id"];
	
	if (halfword(b,48) != -1) {
		fprintf(stderr,"Error finding product description block.\n");
		return 6;
	}
	
	[d setObject:[NSNumber numberWithFloat:(word(b,50) / 1000.0f)] forKey:@"radar_latitude"];
	[d setObject:[NSNumber numberWithFloat:(word(b,54) / 1000.0f)] forKey:@"radar_longitude"];	
	[d setObject:[NSNumber numberWithShort:halfword(b,58)] forKey:@"radar_altitude"];
	[d setObject:[NSNumber numberWithShort:halfword(b,60)] forKey:@"product_code"];
	[d setObject:[NSNumber numberWithShort:halfword(b,62)] forKey:@"operational_mode"];
	[d setObject:[NSNumber numberWithShort:halfword(b,64)] forKey:@"volume_coverage_pattern"];
	[d setObject:[NSNumber numberWithShort:halfword(b,66)] forKey:@"sequence_number"];
	[d setObject:[NSNumber numberWithShort:halfword(b,68)] forKey:@"volume_scan_number"];
	
	t = ((halfword(b,70) - 1) * 86400) + word(b,72);
	[d setObject:[NSDate dateWithTimeIntervalSince1970:t] forKey:@"volume_scan_time"];
	
	t = ((halfword(b,76) - 1) * 86400) + word(b,78);
	[d setObject:[NSDate dateWithTimeIntervalSince1970:t] forKey:@"product_generation_time"];
	
	[d setObject:[NSNumber numberWithShort:halfword(b,86)] forKey:@"elevation_number"];
	[d setObject:[NSNumber numberWithFloat:(halfword(b,88) / 10.0f)] forKey:@"elevation_angle"];
	
	short m = halfword(b,122);
	if (m == -33) {
		[d setObject:[NSNumber numberWithInteger:NSNotFound] forKey:@"maximum_reflectivity"];
	} else {
		[d setObject:[NSNumber numberWithShort:m] forKey:@"maximum_reflectivity"];
	}
	
	[d setObject:[NSNumber numberWithUnsignedChar:b[130]] forKey:@"calibration_constant"];
	
	for (i = 1; i <= 16; i++) {
		NSMutableString *thresholdString = [NSMutableString string];
		
		unsigned char msb = b[90 + 2*(i - 1)];
		unsigned char lsb = b[91 + 2*(i - 1)];
		
		if (msb & 1)
			[thresholdString appendString:@"-"];
		if (msb & 2)
			[thresholdString appendString:@"+"];
		if (msb & 4)
			[thresholdString appendString:@"<"];
		if (msb & 8)
			[thresholdString appendString:@">"];
		
		if (msb & 128) {
			if (lsb == 1)
				[thresholdString appendString:@"TH"];
			if (lsb == 2)
				[thresholdString appendString:@"ND"];
			if (lsb == 3)
				[thresholdString appendString:@"RF"];
		} else {
			if (msb & 16)
				[thresholdString appendFormat:@"%.1f",(lsb / 10.0f)];
			if (msb & 32)
				[thresholdString appendFormat:@"%.2f",(lsb / 20.0f)];
			if (msb & 64)
				[thresholdString appendFormat:@"%.2f",(lsb / 100.0f)];
			if (!(msb & 16 || msb & 32 || msb & 64))
				[thresholdString appendFormat:@"%d",lsb];
		}
		
		NSString *thresholdKey = [NSString stringWithFormat:@"threshold_%d",i];
		[d setObject:[NSString stringWithString:thresholdString] forKey:thresholdKey];
	}
	
	unsigned int sym_offset = 30 + 2 * halfword(b,140);
	
	if(halfword(b,sym_offset) != -1 || halfword(b,sym_offset+2) != 1) {
		fprintf(stderr,"Error finding product symbology block.\n");
		return 7;
	}
	
	short layer_count = halfword(b,sym_offset+8);
	NSMutableArray *layers = [NSMutableArray arrayWithCapacity:(NSUInteger)layer_count];
	int previous_layer_length = 0;
	
	for (i = 0; i < layer_count; i++) {
		unsigned int o = sym_offset + 10 + previous_layer_length;
		
		if (halfword(b,o) != -1) {
			fprintf(stderr,"Error finding layer %d.\n",i);
			return 8;
		}
		
		if (b[o+6] != 175 || b[o+7] != 31) {
			fprintf(stderr,"Error, only radial data supported for now.\n");
			return 9;			
		}
		
		NSMutableDictionary *layer = [NSMutableDictionary dictionary];
		[layer setObject:[NSNumber numberWithShort:halfword(b,o+8)] forKey:@"index_of_first_range_bin"];
		[layer setObject:[NSNumber numberWithShort:halfword(b,o+10)] forKey:@"range_bin_count"];
		[layer setObject:[NSNumber numberWithShort:halfword(b,o+12)] forKey:@"i_center_of_sweep"];
		[layer setObject:[NSNumber numberWithShort:halfword(b,o+14)] forKey:@"j_center_of_sweep"];
		[layer setObject:[NSNumber numberWithFloat:(halfword(b,o+16) / 1000.0f)] forKey:@"scale_factor"];
		
		short rc = halfword(b,o+18);
		[layer setObject:[NSNumber numberWithShort:rc] forKey:@"radial_count"];
		
		NSMutableArray *radials = nil;
		if (rc)
			radials = [NSMutableArray array];
		
		int j;
		unsigned int ro = o + 20;
		for (j = 0; j < rc; j++) {
			NSMutableDictionary *radial = [NSMutableDictionary dictionary];
			
			short rle_halfword_count = halfword(b,ro);
			[radial setObject:[NSNumber numberWithFloat:(halfword(b,ro+2) / 10.0f)] forKey:@"start_angle"];
			[radial setObject:[NSNumber numberWithFloat:(halfword(b,ro+4) / 10.0f)] forKey:@"angle_delta"];
			
			NSMutableArray *range_bins = [NSMutableArray array];
			ro = ro + 6;
			
			int k;
			for (k = 0; k < (rle_halfword_count * 2); k++) {
				unsigned char rle = b[ro];
				unsigned char length = rle >> 4;
			 	unsigned char value = rle & 15;
				
				int l;
				for (l = 0; l < length; l++) {
					[range_bins addObject:[NSNumber numberWithUnsignedChar:value]];
				}
				
				ro++;
			}

			[radial setObject:[NSArray arrayWithArray:range_bins] forKey:@"range_bins"];
			[radials addObject:[NSDictionary dictionaryWithDictionary:radial]];			
		}
		
		[layer setObject:[NSArray arrayWithArray:radials] forKey:@"radials"];
		[layers addObject:[NSDictionary dictionaryWithDictionary:layer]];
	}
	
	[d setObject:[NSArray arrayWithArray:layers] forKey:@"layers"];

	free(b);
	
	if ([outputMode isEqualToString:@"plist"]) {
		NSError *err = nil;
		NSOutputStream *outputStream = [NSOutputStream outputStreamToFileAtPath:outputFilePath append:NO];
		[outputStream open];
		[NSPropertyListSerialization writePropertyList:[NSDictionary dictionaryWithDictionary:d]
											  toStream:outputStream
												format:NSPropertyListXMLFormat_v1_0
											   options:0
												 error:&err];
		[outputStream close];
		if (err != nil) {
			[[err description] writeToFile:@"/dev/stderr" atomically:NO encoding:NSUTF8StringEncoding error:NULL];
			return 10;
		}
	}
	
	if ([outputMode isEqualToString:@"bplist"]) {
		NSError *err = nil;
		NSOutputStream *outputStream = [NSOutputStream outputStreamToFileAtPath:outputFilePath append:NO];
		[outputStream open];
		[NSPropertyListSerialization writePropertyList:[NSDictionary dictionaryWithDictionary:d]
											  toStream:outputStream
												format:NSPropertyListBinaryFormat_v1_0
											   options:0
												 error:&err];
		[outputStream close];
		if (err != nil) {
			[[err description] writeToFile:@"/dev/stderr" atomically:NO encoding:NSUTF8StringEncoding error:NULL];
			return 10;
		}
	}
	
	if (![outputMode isEqualToString:@"plist"] && ![outputMode isEqualToString:@"bplist"]) {
		NSDate *mt = [d objectForKey:@"message_time"];
		[d setObject:[NSNumber numberWithDouble:[mt timeIntervalSince1970]] forKey:@"message_time"];
		
		NSDate *vst = [d objectForKey:@"volume_scan_time"];
		[d setObject:[NSNumber numberWithDouble:[vst timeIntervalSince1970]] forKey:@"volume_scan_time"];
		
		NSDate *pgt = [d objectForKey:@"product_generation_time"];
		[d setObject:[NSNumber numberWithDouble:[pgt timeIntervalSince1970]] forKey:@"product_generation_time"];
		
		NSString *json = [d JSONRepresentation];		
		[json writeToFile:outputFilePath atomically:YES encoding:NSUTF8StringEncoding error:NULL];
	}

    [pool drain];
    return 0;
}
