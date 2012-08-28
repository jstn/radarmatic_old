[
	'panel.png',
	'panel_playdown.png',
	'panel_pausedown.png',
	'panel_zindown.png',
	'panel_zoutdown.png',
	'panel_animating.png',
	'panel_animating_zindown.png',
	'panel_animating_zoutdown.png'
].each(function(src) {
	$('radarmatic').adopt(
		new Element('img',{
			'src': src,
			'style': 'display: none;'
		})
	);
});

var current_site = Cookie.read('current_site') ? Cookie.read('current_site') : DEFAULT_SITE;
current_site = START_OVERRIDE ? START_OVERRIDE : current_site;
var current_palette = Cookie.read('palette') ? Cookie.read('palette') : 'green';
var current_product;
var centre = new google.maps.LatLng(NEXRAD_SITES[current_site]['lat'],NEXRAD_SITES[current_site]['lng'],false);
var radar_overlay;
var last_created;
var animating;
var ajax;
var gmap;
var threshold = 2;
var panel = 'front';
var ring_width = 8;
var last_keys_pressed = [];

window.addEvent('keydown', function(evt) { 
    last_keys_pressed.push(evt.key);
    
    if (last_keys_pressed[0] == 's' && last_keys_pressed[1] == 'a' &&
        last_keys_pressed[2] == 'v' && last_keys_pressed[3] == 'e' &&
        radar_overlay && radar_overlay._canvas)
    {
        var url = radar_overlay._canvas.toDataURL('image/png');
        window.location = url;
        last_keys_pressed = [];
    }
    
    if (last_keys_pressed.length > 3)
        last_keys_pressed = last_keys_pressed.slice(0,4);
});

var safari5 = Browser.Engine.webkit && navigator.appVersion.indexOf('Version/5') != -1 && navigator.appVersion.indexOf('Chrome') == -1;
var safari6 = Browser.Engine.webkit && navigator.appVersion.indexOf('Version/6') != -1 && navigator.appVersion.indexOf('Chrome') == -1;

if (safari5) {
	$('back').setStyle('-webkit-transform','rotateY(180deg)');
	$('back').setStyle('opacity',1.0);
} else if (safari6) {
	//safari 6 has a rotateY bug :(
}

var palettes = {
	'green':  ['#406140','#287e28','#3ca014','#78dc14','#fafa14','#facc14','#fa9914','#fa4f14','#fa0014','#fa0014','#dc1e46','#c81e64','#aa1e96','#ff009c','#ffffff'],
	'purple': ['#702da0','#7407a0','#f9099e','#220e94','#255aaa','#129f51','#50bf34','#d7ef0b','#a0d841','#229bd2','#0ce7fb','#999999','#666666','#333333','#ffffff'],
	'mono':   ['#cccccc','#aaaaaa','#999999','#777777','#666666','#555555','#444444','#333333','#222222','#111111','#000000','#000000','#000000','#000000','#ffffff'],
	'blue':   ['#d8eeff','#bcdffd','#a3d4fc','#7ec0f5','#64aeeb','#5d8be8','#4667e4','#414ce3','#4030de','#5d24dd','#7724dd','#9124dd','#af1bda','#cb1bda','#ffffff'],	
};

function drawLegend() {
	var blockSize = 15;
	var legend = new Element('div',{
		'styles': {
			'position': 'absolute',
			'top': '15px',
			'right': '15px',
			'height': blockSize.toString()+'px',
			'width': (blockSize*15).toString()+'px'
		}
	});

	palettes[current_palette].each(function(color,i) {
		if (i < (threshold - 1))
			return;
		var block = new Element('div',{
			'styles': {
				'background-color': color,	
				'position': 'absolute',
				'top': '0px',
				'left': (i*15).toString()+'px',
				'height': blockSize.toString()+'px',
				'width': blockSize.toString()+'px',
				'text-align': 'center',
				'font': '8px helvetica',
				'line-height': blockSize.toString()+'px',
				'color': i == 14 ? 'black' : 'white',
				'opacity': 0.85
			}
		}).set('html',((i+1)*5).toString());
		legend.adopt(block);
	});
	
	$(document.body).adopt(legend);
}

var frames = [];
var timer = animateFrames.periodical(Browser.Engine.gecko && Browser.Platform.mac ? 250: 150);
var current_frame = 0;
var total_frames = 36;

function animateFrames() {
	if (animating && radar_overlay._canvas && current_frame < frames.length) {
		drawRadial(radar_overlay._canvas,frames[current_frame]);
		current_frame += 1;
        if (current_frame >= total_frames)
            current_frame = 0;
	}
}

function receiveFrame(data) {
	frames.push(data);
	frames.sort(function(a,b) {
		var s = 'volume_scan_time';
		if(a[s] < b[s])
			return -1;
		if(a[s] > b[s])
			return 1;
		return 0;
	});
}

function conditionalCSS() {
	if (Browser.Platform.win || Browser.Platform.linux || Browser.Platform.other) {
		if (Browser.Engine.gecko)
			$$('#name, #date').setStyle('font','11px verdana');
	}
	
	if (safari5) {
		$('panel').setStyle('-webkit-perspective','400');
		$$('#front, #back').setStyles({
			'-webkit-transform-style': 'preserve-3d',
		    '-webkit-backface-visibility': 'hidden',
			'-webkit-transition': 'all 0.8s ease-in-out'
		});
	}
}

$(window).addEvent('load',function() {
	if (Browser.Engine.trident) {
		$(document.body).set('html','Radarmatic requires HTML 5, which Internet Explorer doesn&rsquo;t support :(');
		$(document.body).setStyles({
			'height': '100px',
			'padding': '20px',
			'font': '18px georgia'
		});
		return false;
	} else {
		$('panel').setStyle('display','block');
	}
	
	conditionalCSS();
	viewport();
	
	gmap = new google.maps.Map($('radarmatic'),{
		zoom: Cookie.read('zoom') ? Cookie.read('zoom').toInt() : 7,
		center: centre,
		disableDefaultUI: true,
		disableDoubleClickZoom: true,
		scrollwheel: false,
   		mapTypeId: google.maps.MapTypeId.TERRAIN
	});
	
	google.maps.event.addListener(gmap,'dragend',function() {
		centre = this.getCenter();
		var ll = new google.maps.LatLng(centre.lat(),centre.lng(),false);
		var n = nearestRadar(ll.lat(),ll.lng());
		if (n != current_site) 
			loadRadar(n);
	});
	
	google.maps.event.addListener(gmap,'zoom_changed',function() {
		stopAnimation();
		if(radar_overlay) {
			radar_overlay.setMap(null);	
			radar_overlay = null;
		}		
		(function() {
			last_created = null;
			loadRadar(current_site);
		}).delay(200);
		Cookie.write('zoom',gmap.getZoom().toString(),{duration:365});
	});
	
	$(window).addEvent('resize',function() {
		gmap.setCenter(centre);
	});
	
	for (r in NEXRAD_SITES) {
		var p = new google.maps.LatLng(NEXRAD_SITES[r]['lat'],NEXRAD_SITES[r]['lng'],false);
		new DotOverlay(p);
	}

	loadRadar(current_site);
	
	$('animation').addEvent('mousedown',function() {
		$('front').setStyle('background',animating ? "url('panel_pausedown.png')" : "url('panel_playdown.png')");
		animating ? stopAnimation() : startAnimation();
	});
	
	$('animation').addEvent('mouseup',function() {
		$('front').setStyle('background',animating ? "url('panel_animating.png')" : "url('panel.png')");
	});	
	
	$('zoom_in').addEvent('mousedown',function() {
		$('front').setStyle('background',animating ? "url('panel_animating_zindown.png')" : "url('panel_zindown.png')");

		if (gmap.getZoom() < 15)
			gmap.setZoom(gmap.getZoom() + 1);
	});
	
	$('zoom_out').addEvent('mousedown',function() {
		$('front').setStyle('background',animating ? "url('panel_animating_zoutdown.png')" : "url('panel_zoutdown.png')");

		if (gmap.getZoom() > 3)		
			gmap.setZoom(gmap.getZoom() - 1);		
	});
	
	var mup = function() {
		$('front').setStyle('background',animating ? "url('panel_animating.png')" : "url('panel.png')");
	}
	$('zoom_in').addEvent('mouseup',mup);
	$('zoom_out').addEvent('mouseup',mup);
	
	$$('.info_i').addEvent('click',function() {
		if (panel == 'front') {
			frontToBack();
			panel = 'back';		
		} else {
			backToFront();
			panel = 'front';			
		}
	});
	
	$('palette').addEvent('change',function() {
		current_palette = $('palette').value;
		Cookie.write('palette',current_palette);
		if (!animating) {
			last_created = null;
			loadRadar(current_site);
		}
		drawLegend();
	});
	
	$('palette').value = current_palette;
	drawLegend();
	
    if (window.location.hash != '')
        activateRadarFromHash(window.location.hash);
});

function activateRadarFromHash(hash) {
    var s = hash.substring(1);
    var r = NEXRAD_SITES[s];
    if (r && s != current_site) {
        var c = new google.maps.LatLng(r['lat'],r['lng'],false);
        gmap.setCenter(c);
        gmap.setZoom(7);    
        loadRadar(s);
    }
    window.location.hash = '';
}

function frontToBack() {
	if (safari5) {
		$('front').addClass('front_flip');
		$('back').addClass('back_flip');
	} else {		
		$('front').fade('out');		
		$('back').fade('in');
	}
}

function backToFront() {
	if (safari5) {
		$('front').removeClass('front_flip');
		$('back').removeClass('back_flip');
	} else {
		$('front').fade('in');		
		$('back').fade('out');
	}
}

function stopAnimation() {
	animating = false;
}

function startAnimation() {
	animating = true;
	
	for (var i = 0; i < total_frames; i++) {
		new Request.JSON({
			url: '/'+current_site+'.json?product='+current_product+'&index='+i,
			onSuccess: receiveFrame
		}).get();
	}
}

function nearestRadar(lat,lng) {
	var nearest;
	var distance;
	for (r in NEXRAD_SITES) {
		var d = latLongDistance(lat,lng,NEXRAD_SITES[r]['lat'],NEXRAD_SITES[r]['lng']);
		if (d < distance || !distance) {
			distance = d;
			nearest = r;
		}
	}
	return nearest;
}

function latLongDistance(lat1,lng1,lat2,lng2) {
	return Math.sqrt(Math.pow((lat2-lat1),2)+Math.pow((lng2-lng1),2));
}

function viewport() {
	var size = $(window).getSize();
	if ($('grad')) {
		$('grad').setStyle('width',size.x);
		$('grad').setStyle('height',size.y);
	}
}

window.addEvent('resize',function() {
	viewport();
	if (Browser.Engine.gecko)
		setTimeout(viewport,100);
});

function loadRadar(rid) {
	if (animating)
		$('front').setStyle('background',"url('panel.png')");
	stopAnimation();
	frames = [];
	var product = gmap.getZoom() <= 8 ? 'p20-r' : 'p19r0';
	
	if (ajax && current_site != rid)
		ajax.cancel();
		
	if (radar_overlay && radar_overlay._tween)
		radar_overlay._tween.start('opacity',0);
	
	ajax = new Request.JSON({
		url: '/'+rid+'.json?product='+product,
		onSuccess: function(data) {
			createRadarOverlay(rid,data);
		}
	}).get();
	
	setCurrentSite(rid);
	current_product = product;
}

function setCurrentSite(rid) {
	current_site = rid;
	Cookie.write('current_site',rid,{duration:365});
}

function createRadarOverlay(rid,data) {
	if (radar_overlay) {
		radar_overlay.setMap(null);	
		radar_overlay = null;
	}
	centre = new google.maps.LatLng(data['radar_latitude'],data['radar_longitude'],false);
	radar_overlay = new RadarOverlay(rid,data);	
}

function RadarOverlay(rid,data) {
	this._rid = rid;	
	this._data = data;	
	this._canvas = null;
	this._tween = null;
	this.setMap(gmap);
}

function DotOverlay(loc) {
	this._loc = loc;
	this.setMap(gmap);
}

RadarOverlay.prototype = new google.maps.OverlayView();
DotOverlay.prototype = new google.maps.OverlayView();

RadarOverlay.prototype.onAdd = function() {
    var size = (diaForZoom(gmap.getZoom()) * 2) + (ring_width * 2);
    var max = 4096;
    size = size > max ? max : size;
	this._canvas = new Element('canvas',{
		'width': size,
		'height': size,
		'styles': {
			'position': 'absolute'
		}
	});
	this._tween = new Fx.Tween(this._canvas,{duration:250});

	var panes = this.getPanes();
	panes.overlayLayer.appendChild(this._canvas);
}

DotOverlay.prototype.onAdd = function() {
	this._dot = new Element('img',{
		'src': 'dot.png',
		'styles': {
			'width': 20,
			'height': 20,			
			'position': 'absolute'
		}
	});
	var panes = this.getPanes();
	panes.overlayImage.appendChild(this._dot);
}

RadarOverlay.prototype.onRemove = function() {
	this._canvas.parentNode.removeChild(this._canvas);
	this._canvas = null;
	this._tween = null;	
}

DotOverlay.prototype.onRemove = function() {
	this._dot.parentNode.removeChild(this._dot);
	this._dot = null;
}

RadarOverlay.prototype.draw = function() {
	var ll = new google.maps.LatLng(this._data['radar_latitude'],this._data['radar_longitude'],false);
	var dp = this.getProjection().fromLatLngToDivPixel(ll);		
	var ca = this._canvas.getSize();
	
	var t = dp.y - (ca.y / 2);
	this._canvas.setStyle('top',t);

	var l = dp.x - (ca.x / 2);
	this._canvas.setStyle('left',l);
	
	if (last_created != this._rid) {
		this._tween.set('opacity',0);
		drawRadial(this._canvas,this._data);
		this._tween.start('opacity',0.75);
		last_created = this._rid;
	}
	
	$('name').set('html','<strong>' + this._rid.toUpperCase() + '</strong> ' + NEXRAD_SITES[this._rid]['dsc']);	

	var d = new Date();
	d.setTime(this._data['volume_scan_time'] * 1000);
	$('date').set('html',formatDateAsString(d));
}

function formatDateAsString(d) {
	var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	return d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear()+' '+zeroFill(d.getHours())+':'+zeroFill(d.getMinutes())+':'+zeroFill(d.getSeconds());
}

function zeroFill(n) {
	var s = n.toString();
	return (n > 9) ? s : ('0'+s);
}

DotOverlay.prototype.draw = function() {
	var dp = this.getProjection().fromLatLngToDivPixel(this._loc);		
	var ca = this._dot.getSize();
	
	var t = dp.y - (ca.y / 2);
	this._dot.setStyle('top',t);

	var l = dp.x - (ca.x / 2);
	this._dot.setStyle('left',l);
}

function drawRadial(canvas,data) {
	var context = canvas.getContext('2d');
	context.clearRect(0,0,canvas.getSize().x,canvas.getSize().y);
		
	var cx = canvas.getSize().x / 2;
	var cy = canvas.getSize().y / 2;

	var layer = data['layers'][0];
	var radials = layer['radials'];
	var palette = palettes[current_palette];
	var dia = diaForZoom(gmap.getZoom());
	
	if (dia > 0) {
		context.fillStyle = 'rgba(0,0,0,0.23)';
		var st = Browser.Platform.win && navigator.appVersion.indexOf('Chrome') != -1 ? 0.0001 : 0;
		sweepArc(context,cx,cy,dia,ring_width,st,2*Math.PI);
		context.fill();
	}

	if (data['operational_mode'] == 1)
		return;

	var thickness = thicknessForZoom(gmap.getZoom());

	var gap = -0.5;
	var t = thickness - gap;	

	for (var i = 0; i < radials.length; i++) {
		var radial = radials[i];	
		var range_bins = radial['range_bins'];
		var start = radians(radial['start_angle'] - 90);
		var end = radians(radial['start_angle'] - 89.6 + radial['angle_delta']);
		
		for (var m = threshold; m < 16; m++) {
			context.fillStyle = palette[m-1];
			
			for (var j = 0; j < range_bins.length; j++) {
				if (range_bins[j] == m) {
					var a = (j * thickness);
					var r = a + (a == 0 ? gap : 1);								
					
					var s = t;
					while (range_bins[j+1] == m) {
						s += thickness;
						j++;
					}
										
					sweepArc(context,cx,cy,r,s,start,end);
					context.fill();
				}
			}
		}
	}
	
	var d = new Date();
	d.setTime(data['volume_scan_time'] * 1000);
	$('date').set('html',formatDateAsString(d));
}

/*
function sweepArc(context,center_x,center_y,radius,thickness,start_angle,end_angle) {
	context.beginPath();
	var start_x = radius * Math.cos(start_angle) + center_x;
	var start_y = radius * Math.sin(start_angle) + center_y;
	context.moveTo(start_x,start_y);
	if (radius > 0)
		context.arc(center_x,center_y,radius,start_angle,end_angle,false);
	var next_x = (radius+thickness) * Math.cos(end_angle) + center_x;
	var next_y = (radius+thickness) * Math.sin(end_angle) + center_y; 
	context.lineTo(next_x,next_y);
	context.arc(center_x,center_y,(radius+thickness),end_angle,start_angle,true);
	context.lineTo(start_x,start_y);
	context.closePath();
}
*/

/* Geographically correct sweepArc by Brandon Rhodes (thank you!)
   http://rhodesmill.org/brandon/2012/radarmatic/ */

function sweepArc(context, center_x, center_y, radius, width, start_angle, end_angle) {
    /* Special case: if we are being asked to draw the big gray circle
       around the current radar site, then draw a big gray circle. */

    if (start_angle < 0.1 && end_angle == 2*Math.PI) {
		context.beginPath();
		context.moveTo(radius + center_x, center_y);
		context.arc(center_x, center_y, radius, start_angle, end_angle, false);
		context.lineTo(radius + width + center_x, center_y);
		context.arc(center_x, center_y, radius + width, end_angle, start_angle, true);
		context.closePath();
        return;
    }

    /* Otherwise, we compute the lat/lng corners of the real-world
       trapezoid that bounds this sweep Arc. */

    var thickness = thicknessForZoom(gmap.getZoom());
    var wacky_factor_of_two = 2;
    var radius_km = radius * wacky_factor_of_two / thickness;
    var width_km = width * wacky_factor_of_two / thickness;

    var start_heading = 90 + start_angle * 180 / Math.PI;
    var end_heading = 90 + end_angle * 180 / Math.PI;

    var outer_km = radius_km + width_km;
    var sph = google.maps.geometry.spherical;
    var ll1 = sph.computeOffset(centre, radius_km * 1e3, start_heading);
    var ll2 = sph.computeOffset(centre, outer_km * 1e3, start_heading);
    var ll3 = sph.computeOffset(centre, outer_km * 1e3, end_heading);
    var ll4 = sph.computeOffset(centre, radius_km * 1e3, end_heading);

    /* Figure out the pixel x,y where Google Maps would put each corner. */

    var proj = radar_overlay.getProjection();
    var dp1 = proj.fromLatLngToDivPixel(ll1);
    var dp2 = proj.fromLatLngToDivPixel(ll2);
    var dp3 = proj.fromLatLngToDivPixel(ll3);
    var dp4 = proj.fromLatLngToDivPixel(ll4);

    /* On our HTML5 canvas, the radar station is at the coordinates
       (center_x,center_y) instead of at radar_xy, which are its pixel
       coordinates on the Google Map; so we shift each corner by that
       offset to properly locate the radar image on our canvas. */

    var radar_xy = proj.fromLatLngToDivPixel(centre);
    var offset_x = center_x - radar_xy.x;
    var offset_y = center_y - radar_xy.y;

    context.beginPath();
    context.moveTo(dp1.x + offset_x, dp1.y + offset_y);
    context.lineTo(dp2.x + offset_x, dp2.y + offset_y);
    context.lineTo(dp3.x + offset_x, dp3.y + offset_y);
    context.lineTo(dp4.x + offset_x, dp4.y + offset_y);
    context.closePath();
}

function radians(degrees) {
	return degrees * Math.PI / 180;
}

function diaForZoom(z) {
	var dia = 0;	
	switch (z) {
		case 0:
			dia = 3.59375; break;		
		case 1:
			dia = 7.1875; break;		
		case 2:
			dia = 14.375; break;		
		case 3:
			dia = 28.75; break;		
		case 4:
			dia = 57.5; break;		
		case 5:
			dia = 115; break;
		case 6:
			dia = 230; break;		
		case 7:
			dia = 460; break;		
		case 8:
			dia = 920; break;
		case 9:
			dia = 920; break;
		case 10:
			dia = 1840; break;
		case 11:
			dia = 3680; break;
    	case 12:
    		dia = 7360; break;
        case 13:
            dia = 14720; break;
        case 14:
            dia = 29440; break;
        case 15:
            dia = 58880; break;                        			        			    						
	}
    return dia;
}

function thicknessForZoom(z) {
	var thickness = 1;
	switch (z) {
		case 0:
			thickness = 0.015625; break;		
		case 1:
			thickness = 0.03125; break;		
		case 2:
			thickness = 0.0625; break;		
		case 3:
			thickness = 0.125; break;		
		case 4:
			thickness = 0.25; break;		
		case 5:
			thickness = 0.50; break;		
		case 6:
			thickness = 1.00; break;		
		case 7:
			thickness = 2.00; break;				
		case 8:
			thickness = 4.00; break;
		case 9:
			thickness = 4.00; break;
		case 10:
			thickness = 8.00; break;
		case 11:
			thickness = 16.00; break;
		case 12:
			thickness = 32.00; break;
		case 13:
			thickness = 64.00; break;
		case 14:
			thickness = 128.00; break;
		case 15:
			thickness = 256.00; break;																												
	}
	return thickness;
}
