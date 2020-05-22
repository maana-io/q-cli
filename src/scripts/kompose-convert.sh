#!/bin/sh

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' 

kompose convert -f docker-compose.yaml -o kompose.yaml
printf "${BLUE}Converted docker-compose.yaml to a Kubernetes configuration file.${NC}\n"