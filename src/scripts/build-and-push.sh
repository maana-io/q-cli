#!/bin/bash

GREEN='\033[0;32m'
NC='\033[0m' 
YELLOW='\e[33m'

HOME=`eval echo ~$USER`
DOCKERCONFIG=$HOME/.docker

cat $DOCKERCONFIG/config.json

printf "${YELLOW}Starting Docker build...${NC}"

IMAGE_NAME=$DOCKER_REGISTRY/$SERVICE_ID:$VERSION
docker build -t $IMAGE_NAME .
docker --config=$DOCKERCONFIG push $IMAGE_NAME

printf "${GREEN}Pushed $IMAGE_NAME.${NC}\n"