#!/bin/sh

BLUE='\033[0;34m'
NC='\033[0m' 

docker-compose config > docker-compose-resolved.yaml && mv docker-compose-resolved.yaml docker-compose.yaml
printf "${BLUE}Applied docker-compose configuration settings.${NC}\n"