require 'rubygems'
require 'sinatra'
require 'time'
require 'digest/md5'
require './sites'

MAX_PRODUCT_AGE = 300
MAX_LISTING_AGE = 600
MAX_REVERSE_INDEX = 250

CACHE_PATH = File.expand_path(File.dirname(__FILE__)) + '/cache'
Dir.mkdir(CACHE_PATH) unless File.exists?(CACHE_PATH)

get '/' do
  send_file 'public/index.html'
end

get %r[\A\/([a-zA-Z]{4}).(json|plist|bplist)\z] do
  @rid = params[:captures][0]
  not_found('{}') unless RADAR_IDS.include?(@rid)
  
  @index = params[:index] ? params[:index].to_i : nil
  
  @product = params[:product]
  @product = 'p19r0' unless %w[p19r0 p19r1 p19r2 p19r3 p20-r].include?(@product)
  
  radar_path = radar_file_path(@rid,@product,@index)
  
  lmt = modified_time(@rid,@product,@index)
  last_modified lmt
  
  expires expiration_time(@rid,@product,@index), :public
  
  digest = digest_for_radar(radar_path)
  etag digest
  
  output_type = params[:captures][1]
  
  if output_type == 'json'
    content_type 'application/json'
    json_path = parsed_path_for_radar(:json,radar_path)
    unless File.exists?(json_path)
      `radarparse json #{radar_path} #{json_path}`
    end
    send_file json_path, :filename => "#{@rid}.#{digest}.json", :type => 'application/json', :last_modified => lmt
  end
  
  if output_type == 'plist'
    content_type 'application/xml'
    plist_path = parsed_path_for_radar(:plist,radar_path)
    unless File.exists?(plist_path)
      `radarparse plist #{radar_path} #{plist_path}`
    end
    send_file plist_path, :filename => "#{@rid}.#{digest}.plist", :type => 'application/xml', :last_modified => lmt
  end
  
  if output_type == 'bplist'
    content_type 'application/x-plist'
    bplist_path = parsed_path_for_radar(:bplist,radar_path)
    unless File.exists?(bplist_path)
      `radarparse bplist #{radar_path} #{bplist_path}`
    end
    send_file bplist_path, :filename => "#{@rid}.#{digest}.binary.plist", :type => 'application/x-plist', :last_modified => lmt
  end
  
  not_found
end

def parsed_cache_cleanup
  parsed_path = "#{CACHE_PATH}/parsed"
  return unless File.exists?(parsed_path)
    
  entries = Dir.entries(parsed_path)
  entries.each do |e|
    file_path = "#{parsed_path}/#{e}"
    if File.exists?(file_path) && !['.','..','.DS_store','.svn','.git'].include?(e)
      modified_seconds_ago = Time.new.to_i - File.new(file_path).mtime.to_i
      File.delete(file_path) if (modified_seconds_ago > MAX_PRODUCT_AGE)
    end
  end
end

def parsed_path_for_radar(type,radar_path)
  parsed_path = "#{CACHE_PATH}/parsed"
  Dir.mkdir(parsed_path) unless File.exists?(parsed_path)
  digest = digest_for_radar(radar_path)
  
  return "#{parsed_path}/#{digest}.plist" if (type == :plist)
  return "#{parsed_path}/#{digest}.binary.plist" if (type == :bplist)
  "#{parsed_path}/#{digest}.json"
end

def digest_for_radar(radar_path)
  Digest::MD5.file(radar_path).to_s
end

def expiration_time(rid,product,index)
  if index
    modified_seconds_ago = Time.new.to_i - File.new("#{CACHE_PATH}/listing/#{rid}_#{product}.html").mtime.to_i
    MAX_LISTING_AGE - modified_seconds_ago
  else
    modified_seconds_ago = Time.new.to_i - File.new("#{CACHE_PATH}/nids/#{rid}/#{product}/last.nids").mtime.to_i
    MAX_PRODUCT_AGE - modified_seconds_ago
  end
end

def modified_time(rid,product,index)
  if index
    File.new("#{CACHE_PATH}/listing/#{rid}_#{product}.html").mtime
  else
    File.new("#{CACHE_PATH}/nids/#{rid}/#{product}/last.nids").mtime
  end  
end

def radar_file_path(rid,product,index)
  nids_path = "#{CACHE_PATH}/nids"
  Dir.mkdir(nids_path) unless File.exists?(nids_path)
  rid_path = "#{nids_path}/#{rid}"
  Dir.mkdir(rid_path) unless File.exists?(rid_path)
  prod_path = "#{rid_path}/#{product}"
  Dir.mkdir(prod_path) unless File.exists?(prod_path)
  
  unless index.nil?
    listing = get_listing(rid,product)
    not_found('{}') unless listing
    
    index = 0 if index > MAX_REVERSE_INDEX || index < 0
    file_path = "#{prod_path}/#{listing[index]['time']}.nids"
    
    unless File.exists?(file_path)
      parsed_cache_cleanup
      url = "http://weather.noaa.gov/pub/SL.us008001/DF.of/DC.radar/DS.#{product}/SI.#{rid}/#{listing[index]['file']}"
      `curl -s -o #{file_path} #{url}`
    end
    
    entries = Dir.entries(prod_path)
    if entries.count > MAX_REVERSE_INDEX
      fresh = listing.collect do |l|
        "#{l['time']}.nids"
      end

      entries.each do |e|
        unless fresh.include?(e) || ['.','..','.DS_store','.svn','.git'].include?(e)
          File.delete "#{prod_path}/#{e}"
        end
      end
    end
  else
    file_path = "#{prod_path}/last.nids"
    
    if File.exists?(file_path)
      modified_seconds_ago = Time.new.to_i - File.new(file_path).mtime.to_i
      if modified_seconds_ago > MAX_PRODUCT_AGE
        File.delete(file_path)
      else
        dont_download = true
      end
    end
    
    unless dont_download
      parsed_cache_cleanup
      url = "http://weather.noaa.gov/pub/SL.us008001/DF.of/DC.radar/DS.#{product}/SI.#{rid}/sn.last"
      `curl -s -o #{file_path} #{url}`
    end
  end

  file_path
end

def get_listing(rid,product)
  listing_path = "#{CACHE_PATH}/listing"
  Dir.mkdir(listing_path) unless File.exists?(listing_path)
  
  file_path = "#{listing_path}/#{rid}_#{product}.html"
  exists = File.exists? file_path
  newish = exists ? (Time.now - File.mtime(file_path)) < MAX_LISTING_AGE : false
  unless exists && newish
     url = "http://weather.noaa.gov/pub/SL.us008001/DF.of/DC.radar/DS.#{product}/SI.#{rid}/?C=M;O=D"
     `curl -s -G -d 'C=M;O=D' -o #{file_path} #{url}`
  end
  
  listing = []
  file = File.new(file_path)
  file.each_line do |line|
    if /(sn\.\d+)<\/a>\s*(.+)\s[\w+]/ =~ line
      listing << {
        'file' => $1,
        'time' => Time.parse($2).to_i
      }
    end
  end
  file.close
  
  listing
end
