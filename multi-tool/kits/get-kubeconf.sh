#!/bin/bash

export AWS_REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone | sed 's/\(.*\)[a-z]/\1/')
aws eks update-kubeconfig --region $AWS_REGION --name $EKS_CLUSTER_NAME
