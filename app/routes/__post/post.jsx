import { useEffect, useState } from "react";
import {
  Form,
  useActionData,
  useNavigate,
  useTransition,
} from "@remix-run/react";

import { createOrder } from "../../utils/payment.server";
import { unstable_parseMultipartFormData } from "@remix-run/node";

import { uploadImage } from "../../utils/cloudinary";

import Field from "../../components/ui/Field";
import Button from "../../components/ui/Button";
import Select from "../../components/ui/Select";

import Header from "../../components/layout/Header";
import Main from "../../components/layout/Main";
import Page from "../../components/layout/Page";
import Footer from "../../components/layout/Footer";

import Batch from "../../components/pages/post/Batch";

import { getPostPriceFromCurrencyValue } from "../../helpers/misc";

import {
  batchSchema,
  postSchema,
  getValidationErrors,
} from "../../helpers/validation";

import { CURRENCY_OPTIONS } from "../../constants";
import { DESCRIPTIONS, TITLES } from "../../meta";

export function meta() {
  return {
    title: `${TITLES.POST} / ${TITLES.HOME}`,
    description: DESCRIPTIONS.POST,
  };
}

export async function action({ request }) {
  const formData = await unstable_parseMultipartFormData(
    request,
    async function ({ stream, name, filename, ...otherProps }) {
      if (name === "logo" && filename) {
        const uploadedImage = await uploadImage(stream);

        return uploadedImage.secure_url;
      }

      stream.resume();
    }
  );

  let errors = {};

  const batch = {
    email: formData.get("email"),
    website: formData.get("website"),
    name: formData.get("name"),
    description: formData.get("description"),
    logoURL: formData.get("logo"),
    color: formData.get("color"),
    expiresAfter: formData.get("expiresAfter"),
    currency: formData.get("currency"),
  };

  const postCount = parseInt(formData.get("postCount")) || 0;

  errors = await getValidationErrors(batchSchema, {
    ...batch,
    postCount,
  });

  let posts = [];
  for (let i = 0; i < postCount; i++) {
    const post = {
      title: formData.get(`posts[${i}].title`),
      type: formData.get(`posts[${i}].type`),
      location: formData.get(`posts[${i}].location`),
      salaryStart:
        parseInt(formData.get(`posts[${i}].salaryStart`)) || undefined,
      salaryEnd: parseInt(formData.get(`posts[${i}].salaryEnd`)) || undefined,
      applyLink: formData.get(`posts[${i}].applyLink`),
      applyEmail: formData.get(`posts[${i}].applyEmail`),
      description: formData.get(`posts[${i}].description`),
      tags:
        (formData.get(`posts[${i}].tags`) || null)
          ?.split(",")
          .map(function (tag) {
            return tag.trim();
          }) ?? [],
    };

    const errorsInPost = await getValidationErrors(postSchema, post);

    for (const key in errorsInPost) {
      errors[`posts[${i}].${key}`] = errorsInPost[key];
    }

    posts.push(post);
  }

  if (Object.keys(errors).length) {
    return {
      errors,
    };
  }

  const orderId = await createOrder(postCount, batch.currency);

  return {
    orderId,
    batch,
    posts,
    key: process.env.RAZORPAY_KEY_ID,
  };
}

export default function Post() {
  const actionData = useActionData();
  const transition = useTransition();
  const [paymentFailed, setPaymentFailed] = useState(null);
  const [isLoading, setLoading] = useState(false);

  const navigate = useNavigate();

  const [postCount, setPostCount] = useState(2);
  const [currency, setCurrency] = useState(CURRENCY_OPTIONS[0].value);

  useEffect(
    function () {
      if (actionData && !actionData?.errors) {
        const { amount, id: order_id, currency } = actionData.orderId;

        const options = {
          key: actionData.key,
          amount: amount,
          currency: currency,
          name: "Jobilist",
          order_id: order_id,
          handler: async function (response) {
            const data = {
              orderCreationId: order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
              batch: actionData.batch,
              posts: actionData.posts,
            };

            await fetch("/api/checkPayment", {
              method: "POST",
              body: JSON.stringify(data),
              headers: {
                "Content-Type": "application/json",
              },
            }).then(async (res) => {
              setLoading(true);
              const data = await res.json();
              if (data?.success) {
                navigate("/?success=true");
              }
              if (data?.error) {
                setPaymentFailed(true);
                setLoading(false);
              }
            });
          },
        };

        const paymentObject = new window.Razorpay(options);
        paymentObject.open();
      }
    },
    [actionData, navigate]
  );

  return (
    <Page>
      <Header posting afterPostFailure={paymentFailed} />

      <Main>
        <Form
          replace
          method="POST"
          encType="multipart/form-data"
          className="flex flex-col items-stretch justify-start gap-8 w-[min(720px,_100%)] mx-auto"
        >
          <Batch
            postCount={postCount}
            setPostCount={setPostCount}
            errors={actionData?.errors}
          />

          {actionData?.errors ? (
            <p className="text-center text-red-400 text-xs">
              Please review the errors above.
            </p>
          ) : null}

          {actionData?.errors?.other ? (
            <p className="text-center text-red-400 text-xs">
              {actionData?.errors?.other}
            </p>
          ) : null}

          <div className="w-auto mx-auto flex flex-row items-end justify-center flex-wrap gap-2">
            <Field
              component={Select}
              id="currency"
              name="currency"
              label="Currency"
              currency={currency}
              price={`${
                postCount * (getPostPriceFromCurrencyValue(currency) / 100)
              }`}
              options={CURRENCY_OPTIONS}
              defaultOption={CURRENCY_OPTIONS.find(function (option) {
                return option.value === currency;
              })}
              onChange={setCurrency}
            />

            <Button
              type="submit"
              disabled={transition.state === "submitting" || isLoading}
            >
              Pay & post now
            </Button>
          </div>
        </Form>
      </Main>

      <Footer />
    </Page>
  );
}
