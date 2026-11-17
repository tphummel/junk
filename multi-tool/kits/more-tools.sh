curl -OL https://github.com/fullstorydev/grpcurl/releases/download/v1.8.7/grpcurl_1.8.7_linux_arm64.tar.gz
tar -xzf grpcurl_1.8.7_linux_arm64.tar.gz
mv grpcurl /usr/local/bin/
rm grpcurl_1.8.7_linux_arm64.tar.gz

curl -Lo aws-iam-authenticator https://github.com/kubernetes-sigs/aws-iam-authenticator/releases/download/v0.5.9/aws-iam-authenticator_0.5.9_linux_arm64
chmod +x ./aws-iam-authenticator
mv aws-iam-authenticator /usr/local/bin/