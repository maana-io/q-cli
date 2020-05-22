#!/bin/sh

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' 
YELLOW='\e[33m'

HOME=`eval echo ~$USER`
kubectl apply -f kompose.yaml --kubeconfig="$HOME/.kube/config"
printf "${BLUE}Applied Kubernetes configuration${NC}"