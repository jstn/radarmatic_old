require 'rubygems'
require 'sinatra'
require 'rack/cache'
require './radarmatic'
require 'memcached'
 
set :env, :production
disable :run

use Rack::Cache,
  :verbose     => false,
  :metastore   => 'memcached://localhost:11211/radarmatic_meta_',
  :entitystore => 'memcached://localhost:11211/radarmatic_entity_'

run Sinatra::Application