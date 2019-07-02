#!/bin/bash

serviceName="$1"
servicePath="$2"
registryPath="$3"
version="$4"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Col

tag=$registryPath/$serviceName:$version    
printf "${RED}Building${NC} $serviceName\n"
docker build --tag=$tag $servicePath
printf "${GREEN}Done building${NC} $serviceName:$version\n"
printf "${BLUE}Pushing${NC} $serviceName:$version ${BLUE}to${NC} $registryPath\n"
docker push $tag